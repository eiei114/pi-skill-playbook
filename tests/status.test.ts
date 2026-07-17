import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handlePlaybookCommand } from "../extensions/index.js";
import { buildRunStatusPresentation, notifyLevelForValidation } from "../src/status.js";
import { buildStatusLines, resolveValidationLevel } from "../src/render.js";
import { parsePlaybookYaml, validateRunState } from "../src/validation.js";
import { saveRun, setActiveRun } from "../src/state.js";
import type { PlaybookRunState } from "../src/types.js";

const validYaml = `
version: 1
id: feature-development
name: Feature Development Playbook
entry: grill
skills:
  grill-with-docs:
    role: entry
  to-prd:
    role: internal
steps:
  grill:
    primarySkill: grill-with-docs
    commandHint: "/skill:grill-with-docs <feature idea>"
    doneWhen:
      - Problem boundary is clear.
    transitions:
      - outcome: ready-for-prd
        to: prd
  prd:
    primarySkill: to-prd
    commandHint: "/skill:to-prd create PRD"
    doneWhen:
      - PRD exists.
    transitions:
      - outcome: done
        to: complete
`;

const blockedYaml = validYaml.replace("to: prd", "to: missing-step");

const warningYaml = `${validYaml.replace(
  "  to-prd:\n    role: internal",
  "  to-prd:\n    role: internal\n  Bad_Skill:\n    role: internal",
)}`;

const availableSkills = new Set(["grill-with-docs", "to-prd"]);

const fakePi = {
  getCommands: () => [
    { source: "skill", name: "skill:grill-with-docs" },
    { source: "skill", name: "skill:to-prd" },
  ],
};

class MockUi {
  notifications: Array<{ message: string; level: "info" | "warning" | "error" }> = [];
  widgets: Array<string[] | undefined> = [];

  notify(message: string, level: "info" | "warning" | "error") {
    this.notifications.push({ message, level });
  }

  setWidget(_id: string, content: string[] | undefined) {
    this.widgets.push(content);
  }
}

function activeRun(playbookPath: string, currentStep = "grill"): PlaybookRunState {
  const now = new Date().toISOString();
  return {
    runId: "feature-development-20260608120000",
    playbookId: "feature-development",
    playbookPath,
    currentStep,
    status: "active",
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}

test("resolveValidationLevel distinguishes ok, warnings, and blocked", () => {
  assert.equal(resolveValidationLevel([], []), "ok");
  assert.equal(resolveValidationLevel([], ["warn"]), "warnings");
  assert.equal(resolveValidationLevel(["block"], []), "blocked");
  assert.equal(resolveValidationLevel(["block"], ["warn"]), "blocked");
});

test("buildStatusLines keeps step card readable and prefixes validation summary", () => {
  const playbook = parsePlaybookYaml(validYaml, "feature.yml");
  const run = activeRun(playbook.path);
  const lines = buildStatusLines(playbook, run, [], []);

  assert.equal(lines[0], "Validation: ok");
  assert.match(lines.join("\n"), /Playbook: Feature Development Playbook/);
  assert.match(lines.join("\n"), /Step: grill/);
});

test("buildRunStatusPresentation reports blocked missing skill mappings", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-status-blocked-"));
  try {
    const playbookPath = await writePlaybook(cwd, "feature-development.yml", validYaml);
    const playbook = parsePlaybookYaml(validYaml, playbookPath);
    const run = activeRun(playbookPath);
    const presentation = await buildRunStatusPresentation(cwd, playbook, run, new Set(["grill-with-docs"]));

    assert.equal(presentation.level, "blocked");
    assert.match(presentation.validation.errors.join("\n"), /primarySkill 'to-prd' is not an available Agent Skill/);
    assert.match(presentation.lines.join("\n"), /block:/);
    assert.match(presentation.lines.join("\n"), /Step: grill/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("buildRunStatusPresentation reports warnings without blocking", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-status-warning-"));
  try {
    const playbookPath = await writePlaybook(cwd, "feature-development.yml", warningYaml);
    const playbook = parsePlaybookYaml(warningYaml, playbookPath);
    const run = activeRun(playbookPath);
    const presentation = await buildRunStatusPresentation(cwd, playbook, run, availableSkills);

    assert.equal(presentation.level, "warnings");
    assert.equal(presentation.validation.errors.length, 0);
    assert.match(presentation.validation.warnings.join("\n"), /skill 'Bad_Skill' is not lower-kebab-case/);
    assert.match(presentation.lines.join("\n"), /Validation: warnings/);
    assert.match(presentation.lines.join("\n"), /warn:/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("validateRunState flags run files pointing at missing steps", () => {
  const playbook = parsePlaybookYaml(validYaml, "feature.yml");
  const run = activeRun(playbook.path, "missing-step");
  const errors = validateRunState(playbook, run);

  assert.match(errors.join("\n"), /points to missing step 'missing-step'/);
});

test("buildRunStatusPresentation reports blocked broken transition targets", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-status-transition-"));
  try {
    const playbookPath = await writePlaybook(cwd, "feature-development.yml", blockedYaml);
    const playbook = parsePlaybookYaml(blockedYaml, playbookPath);
    const run = activeRun(playbookPath);
    const presentation = await buildRunStatusPresentation(cwd, playbook, run, availableSkills);

    assert.equal(presentation.level, "blocked");
    assert.match(presentation.validation.errors.join("\n"), /targets missing step 'missing-step'/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("notifyLevelForValidation maps validation level to UI severity", () => {
  assert.equal(notifyLevelForValidation("ok", false), "info");
  assert.equal(notifyLevelForValidation("warnings", false), "warning");
  assert.equal(notifyLevelForValidation("blocked", false), "error");
  assert.equal(notifyLevelForValidation("ok", true), "warning");
});

test("/playbook:status includes validation summary for active run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-status-command-"));
  try {
    const playbookPath = await writePlaybook(cwd, "feature-development.yml", validYaml);
    await writeGitignore(cwd);
    const run = activeRun(playbookPath);
    await saveRun(cwd, run);
    await setActiveRun(cwd, run.runId);

    const ui = new MockUi();
    await handlePlaybookCommand(fakePi as any, "status", { cwd, hasUI: true, ui } as any);

    const message = ui.notifications.at(-1)?.message ?? "";
    assert.match(message, /Validation: ok/);
    assert.match(message, /Playbook: Feature Development Playbook/);
    assert.match(message, /Step: grill/);
    assert.equal(ui.notifications.at(-1)?.level, "info");
    assert.match(ui.widgets.at(-1)?.join("\n") ?? "", /Validation: ok/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

async function writePlaybook(cwd: string, file: string, yaml: string): Promise<string> {
  const dir = join(cwd, ".pi", "playbooks");
  await mkdir(dir, { recursive: true });
  const playbookPath = join(dir, file);
  await writeFile(playbookPath, yaml, "utf8");
  return playbookPath;
}

async function writeGitignore(cwd: string): Promise<void> {
  await writeFile(
    join(cwd, ".gitignore"),
    [".pi/playbook-runs/", ".pi/playbook-records/", ""].join("\n"),
    "utf8",
  );
}
