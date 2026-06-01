import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getPlaybookArgumentCompletions, getPlaybookColonArgumentCompletions } from "../extensions/index.js";
import { saveRun, setActiveRun } from "../src/state.js";
import type { PlaybookRunState } from "../src/types.js";

const playbookYaml = `
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

test("completes playbook ids, run ids, outcomes, and --run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-completions-"));
  try {
    await mkdir(join(cwd, ".pi", "playbooks"), { recursive: true });
    await writeFile(join(cwd, ".pi", "playbooks", "feature-development.yml"), playbookYaml, "utf8");

    const now = new Date().toISOString();
    const activeRun: PlaybookRunState = {
      runId: "feature-development-20260525123456",
      playbookId: "feature-development",
      playbookPath: join(cwd, ".pi", "playbooks", "feature-development.yml"),
      currentStep: "grill",
      status: "active",
      createdAt: now,
      updatedAt: now,
      history: [],
    };
    const completedRun: PlaybookRunState = { ...activeRun, runId: "old-run-20260524000000", status: "completed", updatedAt: "2026-05-24T00:00:00.000Z" };
    await saveRun(cwd, activeRun);
    await saveRun(cwd, completedRun);
    await setActiveRun(cwd, activeRun.runId);

    assert.deepEqual((await getPlaybookArgumentCompletions(cwd, "sta"))?.map((item) => item.value), ["start", "status"]);
    assert.deepEqual((await getPlaybookArgumentCompletions(cwd, "start feature"))?.map((item) => item.value), ["start feature-development"]);
    assert.deepEqual((await getPlaybookArgumentCompletions(cwd, "start feature-development --"))?.map((item) => item.value), ["start feature-development --run "]);
    assert.deepEqual((await getPlaybookArgumentCompletions(cwd, "resume feature"))?.map((item) => item.value), ["resume feature-development-20260525123456"]);
    assert.deepEqual((await getPlaybookArgumentCompletions(cwd, "status old"))?.map((item) => item.value), ["status old-run-20260524000000"]);
    assert.deepEqual((await getPlaybookArgumentCompletions(cwd, "choose ready"))?.map((item) => item.value), ["choose ready-for-prd"]);
    assert.deepEqual((await getPlaybookArgumentCompletions(cwd, "cancel feature"))?.map((item) => item.value), ["cancel feature-development-20260525123456"]);

    assert.deepEqual((await getPlaybookColonArgumentCompletions(cwd, "start", "feature"))?.map((item) => item.value), ["feature-development"]);
    assert.deepEqual((await getPlaybookColonArgumentCompletions(cwd, "start", "feature-development --"))?.map((item) => item.value), ["feature-development --run "]);
    assert.deepEqual((await getPlaybookColonArgumentCompletions(cwd, "start", "feature-development "))?.map((item) => item.value), ["feature-development --run "]);
    assert.deepEqual((await getPlaybookColonArgumentCompletions(cwd, "resume", "feature"))?.map((item) => item.value), ["feature-development-20260525123456"]);
    assert.deepEqual((await getPlaybookColonArgumentCompletions(cwd, "status", "old"))?.map((item) => item.value), ["old-run-20260524000000"]);
    assert.deepEqual((await getPlaybookColonArgumentCompletions(cwd, "choose", "ready"))?.map((item) => item.value), ["ready-for-prd"]);
    assert.deepEqual((await getPlaybookColonArgumentCompletions(cwd, "cancel", "feature"))?.map((item) => item.value), ["feature-development-20260525123456"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
