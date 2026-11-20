import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handlePlaybookCommand, resetGitignoreAdvisorySessionForTest } from "../extensions/index.js";
import { GITIGNORE_SNIPPET } from "../src/gitignore.js";
import { activeFile, listRunIds, loadActiveRunId, loadRun, runFile, saveRun, setActiveRun } from "../src/state.js";
import type { PlaybookRunState } from "../src/types.js";

const basePlaybookYaml = `
version: 1
id: feature-development
name: Feature Development Playbook
entry: grill
skills:
  grill-with-docs:
    role: entry
steps:
  grill:
    primarySkill: grill-with-docs
    commandHint: "/skill:grill-with-docs <feature idea>"
    doneWhen:
      - Problem boundary is clear.
    transitions:
      - outcome: ready-for-prd
        to: prd
      - outcome: needs-rework
        to: grill
  prd:
    primarySkill: grill-with-docs
    commandHint: "/skill:grill-with-docs refine PRD"
    doneWhen:
      - PRD exists.
    transitions: []
`;

const secondPlaybookYaml = basePlaybookYaml
  .replace("id: feature-development", "id: maintenance")
  .replace("name: Feature Development Playbook", "name: Maintenance Playbook");

const fakePi = {
  getCommands: () => [{ source: "skill", name: "skill:grill-with-docs" }],
};

class MockUi {
  notifications: Array<{ message: string; level: "info" | "warning" | "error" }> = [];
  selects: Array<{ title: string; options: string[] }> = [];
  confirmations: Array<{ title: string; message: string }> = [];
  widgets: Array<string[] | undefined> = [];
  confirmResult = true;

  constructor(private readonly choose: (title: string, options: string[]) => string | undefined = (_title, options) => options[0]) {}

  notify(message: string, level: "info" | "warning" | "error") {
    this.notifications.push({ message, level });
  }

  async select(title: string, options: string[]) {
    this.selects.push({ title, options });
    return this.choose(title, options);
  }

  async confirm(title: string, message: string) {
    this.confirmations.push({ title, message });
    return this.confirmResult;
  }

  setWidget(_id: string, content: string[] | undefined) {
    this.widgets.push(content);
  }
}

test("/playbook:start selects a valid playbook and auto-generates a run id", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-select-start-"));
  try {
    await writePlaybook(cwd, "feature-development.yml", basePlaybookYaml);
    await writePlaybook(cwd, "maintenance.yml", secondPlaybookYaml);
    const ui = new MockUi((_title, options) => options.find((option) => option.startsWith("maintenance —")));

    await handlePlaybookCommand(fakePi as any, "start", { cwd, hasUI: true, ui } as any);

    assert.equal(ui.selects.length, 1);
    assert.match(ui.selects[0].title, /Start which playbook/);
    assert.match(ui.selects[0].options.join("\n"), /feature-development .*\(ok\)/);
    assert.match(ui.selects[0].options.join("\n"), /maintenance .*\(ok\)/);
    const activeRunId = await loadActiveRunId(cwd);
    assert.match(activeRunId ?? "", /^maintenance-\d{14}$/);
    const run = await loadRun(cwd, activeRunId ?? "");
    assert.equal(run?.playbookId, "maintenance");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/playbook:choose maps the selected label back to its outcome", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-select-choose-"));
  try {
    await writePlaybook(cwd, "feature-development.yml", basePlaybookYaml);
    const run = await activeRun(cwd, "feature-development-20260608120000", "grill");
    await saveRun(cwd, run);
    await setActiveRun(cwd, run.runId);
    const ui = new MockUi((_title, options) => options.find((option) => option.startsWith("ready-for-prd")));

    await handlePlaybookCommand(fakePi as any, "choose", { cwd, hasUI: true, ui } as any);

    const updated = await loadRun(cwd, run.runId);
    assert.equal(ui.selects.length, 1);
    assert.deepEqual(ui.selects[0].options, ["ready-for-prd → prd", "needs-rework → grill"]);
    assert.equal(updated?.currentStep, "prd");
    assert.equal(updated?.history.at(-1)?.outcome, "ready-for-prd");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/playbook:cancel decline leaves active runs and active pointer unchanged", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-select-cancel-decline-"));
  try {
    const selectedRun = await activeRun(cwd, "feature-development-selected", "grill");
    const otherRun = await activeRun(cwd, "maintenance-keep", "prd");
    await saveRun(cwd, selectedRun);
    await saveRun(cwd, otherRun);
    await setActiveRun(cwd, otherRun.runId);

    const beforeRunFiles = await Promise.all([selectedRun, otherRun].map((run) => readFile(runFile(cwd, run.runId))));
    const beforeActivePointer = await readFile(activeFile(cwd));
    const ui = new MockUi((_title, options) => options.find((option) => option.startsWith(`${selectedRun.runId} —`)));
    ui.confirmResult = false;

    await handlePlaybookCommand(fakePi as any, "cancel", { cwd, hasUI: true, ui } as any);

    assert.equal(ui.selects.length, 1);
    assert.equal(ui.selects[0].title, "Cancel which playbook run?");
    assert.deepEqual(ui.selects[0].options.slice().sort(), [
      `${selectedRun.runId} — ${selectedRun.playbookId} (updated ${selectedRun.updatedAt})`,
      `${otherRun.runId} — ${otherRun.playbookId} (updated ${otherRun.updatedAt})`,
    ].sort());
    assert.deepEqual(ui.confirmations, [{
      title: "Cancel playbook run?",
      message: `${selectedRun.runId} (${selectedRun.playbookId}) will be marked cancelled.`,
    }]);
    assert.deepEqual(await Promise.all([selectedRun, otherRun].map((run) => readFile(runFile(cwd, run.runId)))), beforeRunFiles);
    assert.deepEqual(await readFile(activeFile(cwd)), beforeActivePointer);
    assert.equal(await loadActiveRunId(cwd), otherRun.runId);
    assert.equal((await loadRun(cwd, selectedRun.runId))?.status, "active");
    assert.equal((await loadRun(cwd, otherRun.runId))?.status, "active");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/playbook:cancel confirmation cancels only the selected run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-select-cancel-confirm-"));
  try {
    const selectedRun = await activeRun(cwd, "feature-development-selected", "grill");
    const otherRun = await activeRun(cwd, "maintenance-keep", "prd");
    await saveRun(cwd, selectedRun);
    await saveRun(cwd, otherRun);
    await setActiveRun(cwd, otherRun.runId);
    const ui = new MockUi((_title, options) => options.find((option) => option.startsWith(`${selectedRun.runId} —`)));

    await handlePlaybookCommand(fakePi as any, "cancel", { cwd, hasUI: true, ui } as any);

    assert.deepEqual(ui.confirmations, [{
      title: "Cancel playbook run?",
      message: `${selectedRun.runId} (${selectedRun.playbookId}) will be marked cancelled.`,
    }]);
    const cancelled = await loadRun(cwd, selectedRun.runId);
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(cancelled?.history.at(-1)?.outcome, "cancelled");
    assert.equal((await loadRun(cwd, otherRun.runId))?.status, "active");
    assert.equal(await loadActiveRunId(cwd), otherRun.runId);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("gitignore advisory is shown once per session across start and status", async () => {
  resetGitignoreAdvisorySessionForTest();
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-gitignore-session-"));
  try {
    await writePlaybook(cwd, "feature-development.yml", basePlaybookYaml);
    const ui = new MockUi();

    await handlePlaybookCommand(fakePi as any, "start", { cwd, hasUI: true, ui } as any);
    const afterStart = ui.notifications.map((item) => item.message).join("\n");
    assert.match(afterStart, /Run state is personal/);
    assert.match(afterStart, new RegExp(GITIGNORE_SNIPPET.replace("/", "\\/")));
    assert.equal(ui.notifications.at(-1)?.level, "warning");

    await handlePlaybookCommand(fakePi as any, "status", { cwd, hasUI: true, ui } as any);
    const allMessages = ui.notifications.map((item) => item.message).join("\n");
    const advisoryCount = (allMessages.match(/Run state is personal/g) ?? []).length;
    assert.equal(advisoryCount, 1);
    assert.equal(ui.notifications.at(-1)?.level, "info");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
test("empty states give guidance instead of requiring memorized ids", async () => {
  resetGitignoreAdvisorySessionForTest();
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-empty-states-"));
  try {
    const ui = new MockUi();
    await handlePlaybookCommand(fakePi as any, "start", { cwd, hasUI: true, ui } as any);
    await handlePlaybookCommand(fakePi as any, "resume", { cwd, hasUI: true, ui } as any);

    assert.match(ui.notifications.map((item) => item.message).join("\n"), /No playbooks found/);
    assert.match(ui.notifications.map((item) => item.message).join("\n"), /No active playbook runs/);
    assert.equal((await listRunIds(cwd)).length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

async function writePlaybook(cwd: string, file: string, yaml: string) {
  const dir = join(cwd, ".pi", "playbooks");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), yaml, "utf8");
}

async function activeRun(cwd: string, runId: string, currentStep: string): Promise<PlaybookRunState> {
  const now = new Date().toISOString();
  return {
    runId,
    playbookId: "feature-development",
    playbookPath: join(cwd, ".pi", "playbooks", "feature-development.yml"),
    currentStep,
    status: "active",
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}
