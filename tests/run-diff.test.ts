import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  toRunDiffEntry,
  computeRunDiff,
  formatRunDiff,
  loadRecentRunDiffs,
} from "../src/run-diff.js";
import { handlePlaybookCommand } from "../extensions/index.js";
import { saveRun } from "../src/state.js";
import type { PlaybookRunHistoryEntry, PlaybookRunState } from "../src/types.js";

const baseHistorySame: PlaybookRunHistoryEntry[] = [
  { at: "2026-06-01T10:00:00.000Z", step: "grill", outcome: "ready-for-prd", to: "prd" },
  { at: "2026-06-01T11:00:00.000Z", step: "prd", outcome: "ready-for-issues", to: "issues" },
  { at: "2026-06-01T12:00:00.000Z", step: "issues", outcome: "complete", to: "complete" },
];

const baseHistoryChanged: PlaybookRunHistoryEntry[] = [
  { at: "2026-06-01T10:00:00.000Z", step: "grill", outcome: "ready-for-prd", to: "prd" },
  { at: "2026-06-01T11:00:00.000Z", step: "prd", outcome: "ready-for-issues", to: "implement" },
  { at: "2026-06-01T12:00:00.000Z", step: "implement", outcome: "complete", to: "complete" },
];

const baseHistoryExtraStep: PlaybookRunHistoryEntry[] = [
  { at: "2026-06-01T10:00:00.000Z", step: "grill", outcome: "ready-for-prd", to: "prd" },
  { at: "2026-06-01T11:00:00.000Z", step: "prd", outcome: "ready-for-issues", to: "issues" },
  { at: "2026-06-01T12:00:00.000Z", step: "issues", outcome: "ready-for-review", to: "review" },
  { at: "2026-06-01T13:00:00.000Z", step: "review", outcome: "pass", to: "complete" },
];

function makeRun(
  runId: string,
  updatedAt: string,
  history: PlaybookRunHistoryEntry[],
  status: PlaybookRunState["status"] = "completed",
): PlaybookRunState {
  return {
    runId,
    playbookId: "feature-development",
    playbookPath: ".pi/playbooks/feature-development.yml",
    currentStep: history.at(-1)?.to ?? "complete",
    status,
    createdAt: updatedAt,
    updatedAt,
    history,
  };
}

class MockUi {
  notifications: Array<{ message: string; level: "info" | "warning" | "error" }> = [];
  selects: Array<{ title: string; options: string[] }> = [];

  constructor(
    private readonly choose: (title: string, options: string[]) => string | undefined = (_title, options) => options[0],
  ) {}

  notify(message: string, level: "info" | "warning" | "error") {
    this.notifications.push({ message, level });
  }

  async select(title: string, options: string[]) {
    this.selects.push({ title, options });
    return this.choose(title, options);
  }

  setWidget(_id: string, _content: string[] | undefined) {}
}

// --- toRunDiffEntry ---

test("toRunDiffEntry returns undefined for non-completed runs", () => {
  const active = makeRun("run-1", "2026-06-01T12:00:00.000Z", baseHistorySame, "active");
  const cancelled = makeRun("run-2", "2026-06-01T12:00:00.000Z", baseHistorySame, "cancelled");

  assert.equal(toRunDiffEntry(active, "Test"), undefined);
  assert.equal(toRunDiffEntry(cancelled, "Test"), undefined);
});

test("toRunDiffEntry produces entry for completed runs", () => {
  const run = makeRun("run-1", "2026-06-01T12:00:00.000Z", baseHistorySame);
  const entry = toRunDiffEntry(run, "Feature Development Playbook");

  assert.ok(entry);
  assert.equal(entry.runId, "run-1");
  assert.equal(entry.playbookName, "Feature Development Playbook");
  assert.equal(entry.completedAt, "2026-06-01T12:00:00.000Z");
  assert.equal(entry.finalOutcome, "complete");
  assert.equal(entry.stepCount, 3);
  assert.deepEqual(entry.history, baseHistorySame);
});

// --- computeRunDiff ---

test("computeRunDiff shows identical output when histories match", () => {
  const newer = toRunDiffEntry(makeRun("newer", "2026-06-02T12:00:00.000Z", baseHistorySame), "A")!;
  const older = toRunDiffEntry(makeRun("older", "2026-06-01T12:00:00.000Z", baseHistorySame), "A")!;

  const result = computeRunDiff(newer, older);
  assert.equal(result.changes.length, 1);
  assert.match(result.changes[0], /All steps match.*identical/);
});

test("computeRunDiff shows changed output when final outcome differs", () => {
  const newer = toRunDiffEntry(
    makeRun("newer", "2026-06-02T12:00:00.000Z", baseHistoryChanged),
    "Feature Development Playbook",
  )!;
  const older = toRunDiffEntry(makeRun("older", "2026-06-01T12:00:00.000Z", baseHistorySame), "Feature Development Playbook")!;

  const result = computeRunDiff(newer, older);
  assert.ok(result.changes.length > 0);
  assert.ok(result.changes.some((c) => c.includes("Step 2 differs")));
  assert.ok(result.changes.some((c) => c.includes("implement")));
  assert.ok(result.changes.some((c) => c.includes("issues")));
});

test("computeRunDiff shows extra step added", () => {
  const newer = toRunDiffEntry(
    makeRun("newer", "2026-06-02T12:00:00.000Z", baseHistoryExtraStep),
    "Feature Development Playbook",
  )!;
  const older = toRunDiffEntry(makeRun("older", "2026-06-01T12:00:00.000Z", baseHistorySame), "Feature Development Playbook")!;

  const result = computeRunDiff(newer, older);
  assert.ok(result.changes.length > 0);
  assert.ok(result.changes.some((c) => c.includes("Step 4 added")));
  assert.ok(result.changes.some((c) => c.includes("review")));
  assert.ok(result.changes.some((c) => c.includes("pass")));
});

test("computeRunDiff shows playbook name difference", () => {
  const newer = toRunDiffEntry(makeRun("newer", "2026-06-02T12:00:00.000Z", baseHistorySame), "Playbook A")!;
  const older = toRunDiffEntry(makeRun("older", "2026-06-01T12:00:00.000Z", baseHistorySame), "Playbook B")!;

  const result = computeRunDiff(newer, older);
  assert.ok(result.changes.some((c) => c.includes("Playbook changed")));
  assert.ok(result.changes.some((c) => c.includes("Playbook A")));
  assert.ok(result.changes.some((c) => c.includes("Playbook B")));
});

test("computeRunDiff shows final outcome difference", () => {
  const changed = baseHistorySame.map((h) => ({ ...h }));
  changed[changed.length - 1] = { ...changed[changed.length - 1], outcome: "cancelled", to: "cancelled" };

  const newer = toRunDiffEntry(makeRun("newer", "2026-06-02T12:00:00.000Z", baseHistorySame), "Test")!;
  const older = toRunDiffEntry(makeRun("older", "2026-06-01T12:00:00.000Z", changed), "Test")!;

  const result = computeRunDiff(newer, older);
  assert.ok(result.changes.some((c) => c.includes("Final outcome")));
  assert.ok(result.changes.some((c) => c.includes("complete")));
  assert.ok(result.changes.some((c) => c.includes("cancelled")));
});

test("computeRunDiff shows step removed", () => {
  const newer = toRunDiffEntry(makeRun("newer", "2026-06-02T12:00:00.000Z", baseHistorySame), "Test")!;
  const older = toRunDiffEntry(makeRun("older", "2026-06-01T12:00:00.000Z", baseHistoryExtraStep), "Test")!;

  const result = computeRunDiff(newer, older);
  assert.ok(result.changes.some((c) => c.includes("Step 4 removed")), JSON.stringify(result.changes));
  assert.ok(result.changes.some((c) => c.includes("review")));
});

// --- formatRunDiff ---

test("formatRunDiff produces readable lines", () => {
  const newer = toRunDiffEntry(makeRun("newer", "2026-06-02T12:00:00.000Z", baseHistoryChanged), "Feature Development Playbook")!;
  const older = toRunDiffEntry(makeRun("older", "2026-06-01T12:00:00.000Z", baseHistorySame), "Feature Development Playbook")!;
  const result = computeRunDiff(newer, older);
  const lines = formatRunDiff(result);

  assert.match(lines[0], /Run diff:/);
  assert.ok(lines.some((line) => line.includes("Newer:")));
  assert.ok(lines.some((line) => line.includes("Older:")));
  assert.ok(lines.some((line) => line.includes("Changes:")));
  assert.ok(lines.some((line) => line.includes("Step 2 differs")));
});

test("formatRunDiff handles identical runs", () => {
  const newer = toRunDiffEntry(makeRun("newer", "2026-06-02T12:00:00.000Z", baseHistorySame), "Test")!;
  const older = toRunDiffEntry(makeRun("older", "2026-06-01T12:00:00.000Z", baseHistorySame), "Test")!;
  const result = computeRunDiff(newer, older);
  const lines = formatRunDiff(result);

  assert.ok(lines.some((line) => /All steps match.*identical/.test(line)));
});

// --- loadRecentRunDiffs ---

test("loadRecentRunDiffs returns empty when fewer than 2 completed runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-rundiff-empty-"));
  try {
    const diffs = await loadRecentRunDiffs(cwd);
    assert.equal(diffs.length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadRecentRunDiffs returns empty with only one completed run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-rundiff-one-"));
  try {
    await saveRun(cwd, makeRun("run-1", "2026-06-01T12:00:00.000Z", baseHistorySame));
    const diffs = await loadRecentRunDiffs(cwd);
    assert.equal(diffs.length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadRecentRunDiffs ignores active and cancelled runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-rundiff-filter-"));
  try {
    await saveRun(cwd, makeRun("active-run", "2026-06-01T12:00:00.000Z", baseHistorySame, "active"));
    await saveRun(cwd, makeRun("cancelled-run", "2026-06-01T12:00:00.000Z", baseHistorySame, "cancelled"));
    const diffs = await loadRecentRunDiffs(cwd);
    assert.equal(diffs.length, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadRecentRunDiffs produces adjacent diffs for multiple completed runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-rundiff-multi-"));
  try {
    await writePlaybook(cwd);
    await saveRun(cwd, makeRun("run-3", "2026-06-03T12:00:00.000Z", baseHistorySame));
    await saveRun(cwd, makeRun("run-2", "2026-06-02T12:00:00.000Z", baseHistoryChanged));
    await saveRun(cwd, makeRun("run-1", "2026-06-01T12:00:00.000Z", baseHistorySame));

    const diffs = await loadRecentRunDiffs(cwd);
    assert.equal(diffs.length, 2);
    assert.equal(diffs[0].newer.runId, "run-3");
    assert.equal(diffs[0].older.runId, "run-2");
    assert.equal(diffs[1].newer.runId, "run-2");
    assert.equal(diffs[1].older.runId, "run-1");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadRecentRunDiffs respects count parameter", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-rundiff-count-"));
  try {
    await writePlaybook(cwd);
    await saveRun(cwd, makeRun("run-3", "2026-06-03T12:00:00.000Z", baseHistorySame));
    await saveRun(cwd, makeRun("run-2", "2026-06-02T12:00:00.000Z", baseHistoryChanged));
    await saveRun(cwd, makeRun("run-1", "2026-06-01T12:00:00.000Z", baseHistorySame));

    const diffs = await loadRecentRunDiffs(cwd, 2);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].newer.runId, "run-3");
    assert.equal(diffs[0].older.runId, "run-2");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadRecentRunDiffs paired with same-history runs shows identical output", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-rundiff-identical-"));
  try {
    await writePlaybook(cwd);
    await saveRun(cwd, makeRun("run-2", "2026-06-02T12:00:00.000Z", baseHistorySame));
    await saveRun(cwd, makeRun("run-1", "2026-06-01T12:00:00.000Z", baseHistorySame));

    const diffs = await loadRecentRunDiffs(cwd);
    assert.equal(diffs.length, 1);
    assert.match(diffs[0].changes[0], /All steps match.*identical/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

// --- /playbook:rundiff command ---

test("/playbook:rundiff reports guidance when no completed runs exist", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-rundiff-command-empty-"));
  try {
    const ui = new MockUi();
    await handlePlaybookCommand({ getCommands: () => [] } as any, "rundiff", { cwd, hasUI: true, ui } as any);

    const message = ui.notifications.map((item) => item.message).join("\n");
    assert.match(message, /Not enough completed runs/);
    assert.match(message, /at least 2 completed runs/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/playbook:rundiff shows diff for two completed runs", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-rundiff-command-two-"));
  try {
    await writePlaybook(cwd);
    await saveRun(cwd, makeRun("run-2", "2026-06-02T12:00:00.000Z", baseHistorySame));
    await saveRun(cwd, makeRun("run-1", "2026-06-01T12:00:00.000Z", baseHistorySame));

    const ui = new MockUi();
    await handlePlaybookCommand({ getCommands: () => [] } as any, "rundiff", { cwd, hasUI: true, ui } as any);

    const message = ui.notifications.map((item) => item.message).join("\n");
    assert.match(message, /Run diff:/);
    assert.match(message, /run-2 vs run-1/);
    assert.match(message, /All steps match/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("/playbook:rundiff shows changed output when histories differ", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-rundiff-command-changed-"));
  try {
    await writePlaybook(cwd);
    await saveRun(cwd, makeRun("run-2", "2026-06-02T12:00:00.000Z", baseHistoryChanged));
    await saveRun(cwd, makeRun("run-1", "2026-06-01T12:00:00.000Z", baseHistorySame));

    const ui = new MockUi();
    await handlePlaybookCommand({ getCommands: () => [] } as any, "rundiff", { cwd, hasUI: true, ui } as any);

    const message = ui.notifications.map((item) => item.message).join("\n");
    assert.match(message, /Run diff:/);
    assert.match(message, /Step 2 differs/);
    assert.match(message, /differ/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

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

async function writePlaybook(cwd: string) {
  const dir = join(cwd, ".pi", "playbooks");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "feature-development.yml"), basePlaybookYaml, "utf8");
}
