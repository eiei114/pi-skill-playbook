import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handlePlaybookCommand } from "../extensions/index.js";
import {
  finalOutcome,
  formatCompletedRunLine,
  listCompletedRunSummaries,
  listCompletedRuns,
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
