import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  activeFile,
  clearActiveRun,
  createRunId,
  loadActiveRunId,
  loadRun,
  runFile,
  saveRun,
  setActiveRun,
  slugify,
} from "../src/state.js";
import type { PlaybookRunState } from "../src/types.js";

test("slugifies run names", () => {
  assert.equal(slugify("My Feature!!"), "my-feature");
  assert.equal(slugify("***"), "playbook-run");
  assert.match(createRunId("feature-development", "My Feature"), /^my-feature-\d{14}$/);
});

test("saves, loads, and clears active run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-test-"));
  try {
    const now = new Date().toISOString();
    const run: PlaybookRunState = {
      runId: "run-1",
      playbookId: "feature-development",
      playbookPath: ".pi/playbooks/feature-development.yml",
      currentStep: "grill",
      status: "active",
      createdAt: now,
      updatedAt: now,
      history: [],
    };
    await saveRun(cwd, run);
    await setActiveRun(cwd, run.runId);

    assert.equal(await readFile(runFile(cwd, run.runId), "utf8"), `${JSON.stringify(run, null, 2)}\n`);
    assert.equal(await readFile(activeFile(cwd), "utf8"), `${JSON.stringify({ runId: run.runId }, null, 2)}\n`);
    assert.deepEqual(await loadRun(cwd, "run-1"), run);
    assert.equal(await loadActiveRunId(cwd), "run-1");

    await clearActiveRun(cwd);
    assert.equal(await loadActiveRunId(cwd), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
