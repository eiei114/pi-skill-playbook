import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handlePlaybookCommand } from "../extensions/index.js";
import {
  finalOutcome,
  formatCompletedRunLine,
  listCompletedRunSummaries,
  listCompletedRuns,
  scanCompletedRuns,
  summarizeCompletedRun,
} from "../src/history.js";
import { saveRun } from "../src/state.js";
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
    transitions: []
`;

class MockUi {
  notifications: Array<{ message: string; level: "info" | "warning" | "error" }> = [];
  selects: Array<{ title: string; options: string[] }> = [];

  constructor(private readonly choose: (title: string, options: string[]) => string | undefined = (_title, options) => options[0]) {}

  notify(message: string, level: "info" | "warning" | "error") {
    this.notifications.push({ message, level });
  }

  async select(title: string, options: string[]) {
    this.selects.push({ title, options });
    return this.choose(title, options);
  }

  setWidget(_id: string, _content: string[] | undefined) {}
}

test("listCompletedRuns returns only completed runs newest first", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-history-filter-"));
  try {
    await saveRun(cwd, completedRun("older-run", "2026-06-01T10:00:00.000Z"));
    await saveRun(cwd, activeRun("active-run"));
    await saveRun(cwd, completedRun("newer-run", "2026-06-02T10:00:00.000Z"));
    await saveRun(cwd, cancelledRun("cancelled-run"));

    const runs = await listCompletedRuns(cwd);
    assert.deepEqual(runs.map((run) => run.runId), ["newer-run", "older-run"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("summarizeCompletedRun includes playbook name and final outcome", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-history-summary-"));
  try {
    await writePlaybook(cwd);
    const run = completedRun("feature-development-20260608120000", "2026-06-08T12:00:00.000Z");
    run.history = [{ at: "2026-06-08T12:00:00.000Z", step: "grill", outcome: "complete", to: "complete" }];
    await saveRun(cwd, run);

    const summary = await summarizeCompletedRun(cwd, run);
    assert.equal(summary.playbookName, "Feature Development Playbook");
    assert.equal(summary.completedAt, "2026-06-08T12:00:00.000Z");
    assert.equal(summary.finalOutcome, "complete");
    assert.match(formatCompletedRunLine(summary), /feature-development-20260608120000 — Feature Development Playbook — 2026-06-08T12:00:00.000Z — complete/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("listCompletedRunSummaries resolves names for each run's playbook", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-history-multiple-playbooks-"));
  try {
    await writePlaybook(cwd);
    const dir = join(cwd, ".pi", "playbooks");
    const secondPlaybook = basePlaybookYaml
      .replace("feature-development", "release-readiness")
      .replace("Feature Development Playbook", "Release Readiness Playbook");
    await writeFile(join(dir, "release-readiness.yml"), secondPlaybook, "utf8");

    const firstRun = completedRun("feature-development-1", "2026-06-01T12:00:00.000Z");
    const secondRun = completedRun("release-readiness-1", "2026-06-02T12:00:00.000Z");
    secondRun.playbookId = "release-readiness";
    await saveRun(cwd, firstRun);
    await saveRun(cwd, secondRun);

    const summaries = await listCompletedRunSummaries(cwd);
    assert.deepEqual(summaries.map((summary) => summary.playbookName), [
      "Release Readiness Playbook",
      "Feature Development Playbook",
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("listCompletedRuns keeps healthy runs when one run file is corrupt", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-history-corrupt-"));
  try {
    await writePlaybook(cwd);
    await saveRun(cwd, completedRun("healthy-run", "2026-06-02T10:00:00.000Z"));
    await writeFile(join(cwd, ".pi", "playbook-runs", "broken-run.json"), "not valid json", "utf8");
    await writeFile(join(cwd, ".pi", "playbook-runs", "truncated-run.json"), '{"runId":"truncated-run"', "utf8");

    const runs = await listCompletedRuns(cwd);
    assert.deepEqual(runs.map((run) => run.runId), ["healthy-run"]);

    const scan = await scanCompletedRuns(cwd);
    assert.deepEqual(scan.runs.map((run) => run.runId), ["healthy-run"]);
    assert.equal(scan.problems.length, 2);
    assert.match(scan.problems.join("\n"), /broken-run\.json/);
    assert.match(scan.problems.join("\n"), /truncated-run\.json/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("listCompletedRuns still sorts healthy runs when a parseable run file has the wrong shape", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-history-shape-"));
  try {
    await writePlaybook(cwd);
    await saveRun(cwd, completedRun("older-run", "2026-06-02T09:00:00.000Z"));
    await saveRun(cwd, completedRun("newer-run", "2026-06-02T11:00:00.000Z"));
    // A hand-edited file used to throw `b.updatedAt.localeCompare is not a function`
    // inside the history sort, dropping every healthy run from the listing.
    const badPath = join(cwd, ".pi", "playbook-runs", "handedited-run.json");
    await writeFile(badPath, '{"runId":"handedited-run","status":"completed","updatedAt":42,"history":[]}', "utf8");

    const runs = await listCompletedRuns(cwd);
    assert.deepEqual(runs.map((run) => run.runId), ["newer-run", "older-run"]);

    const scan = await scanCompletedRuns(cwd);
    assert.deepEqual(scan.runs.map((run) => run.runId), ["newer-run", "older-run"]);
    assert.equal(scan.problems.length, 1);
    assert.match(scan.problems[0], /handedited-run\.json/);
    assert.match(scan.problems[0], /cannot be used/);
    assert.match(scan.problems[0], /field "updatedAt" is a number instead of a string/);
    assert.equal(await readFile(badPath, "utf8"), '{"runId":"handedited-run","status":"completed","updatedAt":42,"history":[]}');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/playbook:history lists healthy runs and names a wrong-shape file instead of throwing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-history-shape-ui-"));
  try {
    await writePlaybook(cwd);
    await saveRun(cwd, completedRun("healthy-run", "2026-06-02T10:00:00.000Z"));
    const badPath = join(cwd, ".pi", "playbook-runs", "handedited-run.json");
    await writeFile(badPath, '{"runId":"handedited-run","status":"completed","updatedAt":42,"history":[]}', "utf8");
    const ui = new MockUi();

    await handlePlaybookCommand({ getCommands: () => [] } as any, "history", { cwd, hasUI: true, ui } as any);

    assert.equal(ui.notifications.length, 1);
    const messages = ui.notifications.map((item) => item.message).join("\n");
    assert.match(messages, /healthy-run — Feature Development Playbook — 2026-06-02T10:00:00\.000Z — complete/);
    assert.match(messages, /Final outcome: complete/);
    assert.match(messages, /handedited-run\.json/);
    assert.match(messages, /cannot be used/);
    assert.match(messages, /repair or delete it/);
    assert.equal(ui.notifications.at(-1)?.level, "warning");

    // The wrong-shape file is reported without being deleted or rewritten.
    assert.equal(await readFile(badPath, "utf8"), '{"runId":"handedited-run","status":"completed","updatedAt":42,"history":[]}');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/playbook:history lists the healthy run and names the corrupt file instead of failing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-history-corrupt-ui-"));
  try {
    await writePlaybook(cwd);
    await saveRun(cwd, completedRun("healthier-run", "2026-06-02T10:00:00.000Z"));
    const brokenPath = join(cwd, ".pi", "playbook-runs", "broken-run.json");
    await writeFile(brokenPath, "not valid json", "utf8");
    const ui = new MockUi();

    await handlePlaybookCommand({ getCommands: () => [] } as any, "history", { cwd, hasUI: true, ui } as any);

    const messages = ui.notifications.map((item) => item.message).join("\n");
    assert.match(messages, /healthier-run — Feature Development Playbook — 2026-06-02T10:00:00\.000Z — complete/);
    assert.match(messages, /broken-run\.json/);
    assert.match(messages, /repair or delete it/);
    assert.equal(ui.notifications.at(-1)?.level, "warning");

    // No state file was deleted or rewritten automatically.
    assert.equal(await readFile(brokenPath, "utf8"), "not valid json");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/playbook:history browses stored runs when playbook YAML is invalid", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-history-invalid-definition-"));
  try {
    await saveRun(cwd, completedRun("older-run", "2026-06-01T10:00:00.000Z"));
    await saveRun(cwd, completedRun("newer-run", "2026-06-02T10:00:00.000Z"));
    const definitionPath = join(cwd, ".pi", "playbooks", "feature-development.yml");
    const invalidYaml = "name: [unclosed\n";
    await writePlaybook(cwd);
    await writeFile(definitionPath, invalidYaml, "utf8");
    const runPath = join(cwd, ".pi", "playbook-runs", "older-run.json");
    const storedRun = await readFile(runPath, "utf8");
    const ui = new MockUi((_title, options) => options[1]);
    const pi = { getCommands: () => [] } as any;
    const ctx = { cwd, hasUI: true, ui } as any;

    await handlePlaybookCommand(pi, "history", ctx);

    assert.equal(ui.selects.length, 1);
    assert.equal(ui.selects[0].options[1], "older-run — feature-development — 2026-06-01T10:00:00.000Z — complete");
    assert.equal(ui.notifications.length, 1);
    const [{ message, level }] = ui.notifications;
    assert.equal(level, "warning");
    assert.match(message, /Completed: feature-development\nRun: older-run/);
    assert.match(message, /Final outcome: complete/);
    assert.match(message, /grill → complete \(complete\)/);
    assert.match(message, /Could not look up playbook names; showing stored playbook IDs/);
    assert.equal(await readFile(runPath, "utf8"), storedRun);
    assert.equal(await readFile(definitionPath, "utf8"), invalidYaml);
    await assert.rejects(handlePlaybookCommand(pi, "start", ctx));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("finalOutcome falls back to complete when history is empty", () => {
  const run = completedRun("run-1", "2026-06-08T12:00:00.000Z");
  run.history = [];
  assert.equal(finalOutcome(run), "complete");
});

test("/playbook:history reports empty history with lifecycle guidance", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-history-empty-"));
  try {
    const ui = new MockUi();
    await handlePlaybookCommand({ getCommands: () => [] } as any, "history", { cwd, hasUI: true, ui } as any);

    const message = ui.notifications.map((item) => item.message).join("\n");
    assert.match(message, /No completed playbook runs/);
    assert.match(message, /\/playbook:resume/);
    assert.match(message, /read-only history/);
    assert.equal((await listCompletedRunSummaries(cwd)).length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/playbook:history lists multiple completed runs compactly", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-history-list-"));
  try {
    await writePlaybook(cwd);
    await saveRun(cwd, completedRun("feature-development-20260601120000", "2026-06-01T12:00:00.000Z"));
    await saveRun(cwd, completedRun("feature-development-20260602120000", "2026-06-02T12:00:00.000Z"));
    const ui = new MockUi((_title, options) => options[1]);

    await handlePlaybookCommand({ getCommands: () => [] } as any, "history", { cwd, hasUI: true, ui } as any);

    assert.equal(ui.selects.length, 1);
    assert.match(ui.selects[0].title, /Browse which completed run/);
    assert.equal(ui.selects[0].options.length, 2);
    assert.match(ui.selects[0].options[0], /feature-development-20260602120000 — Feature Development Playbook — 2026-06-02T12:00:00.000Z — complete/);
    assert.match(ui.selects[0].options[1], /feature-development-20260601120000 — Feature Development Playbook — 2026-06-01T12:00:00.000Z — complete/);

    const message = ui.notifications.map((item) => item.message).join("\n");
    assert.match(message, /Completed: Feature Development Playbook/);
    assert.match(message, /Final outcome: complete/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/playbook:status points to history when no active run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-status-history-hint-"));
  try {
    const ui = new MockUi();
    await handlePlaybookCommand({ getCommands: () => [] } as any, "status", { cwd, hasUI: true, ui } as any);

    assert.match(ui.notifications.at(-1)?.message ?? "", /\/playbook:history/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

async function writePlaybook(cwd: string) {
  const dir = join(cwd, ".pi", "playbooks");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "feature-development.yml"), basePlaybookYaml, "utf8");
}

function completedRun(runId: string, updatedAt: string): PlaybookRunState {
  return {
    runId,
    playbookId: "feature-development",
    playbookPath: ".pi/playbooks/feature-development.yml",
    currentStep: "grill",
    status: "completed",
    createdAt: updatedAt,
    updatedAt,
    history: [{ at: updatedAt, step: "grill", outcome: "complete", to: "complete" }],
  };
}

function activeRun(runId: string): PlaybookRunState {
  const now = new Date().toISOString();
  return {
    runId,
    playbookId: "feature-development",
    playbookPath: ".pi/playbooks/feature-development.yml",
    currentStep: "grill",
    status: "active",
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}

function cancelledRun(runId: string): PlaybookRunState {
  const now = new Date().toISOString();
  return {
    runId,
    playbookId: "feature-development",
    playbookPath: ".pi/playbooks/feature-development.yml",
    currentStep: "grill",
    status: "cancelled",
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, step: "grill", outcome: "cancelled", to: "cancelled" }],
  };
}
