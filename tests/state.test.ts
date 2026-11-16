import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  activeFile,
  clearActiveRun,
  createRunId,
  loadActiveRunId,
  loadActiveRunIdSafe,
  loadRun,
  loadRunSafe,
  runFile,
  saveRun,
  scanRuns,
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
    await clearActiveRun(cwd);
    assert.equal(await loadActiveRunId(cwd), undefined);

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
    await clearActiveRun(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("scanRuns keeps healthy runs and reports corrupt or truncated files by name", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-corrupt-run-"));
  try {
    const healthy = run("healthy-run", "completed");
    await saveRun(cwd, healthy);
    await writeFile(runFile(cwd, "corrupt-run"), "not json", "utf8");
    await writeFile(runFile(cwd, "truncated-run"), '{"runId":"truncated-run","playbookId":"feature"', "utf8");
    const active = run("active-run", "active");
    await saveRun(cwd, active);

    const scan = await scanRuns(cwd);
    assert.deepEqual(scan.runs.map((state) => state.runId).sort(), ["active-run", "healthy-run"]);
    assert.equal(scan.problems.length, 2);
    assert.match(scan.problems.join("\n"), /corrupt-run\.json/);
    assert.match(scan.problems.join("\n"), /truncated-run\.json/);
    for (const problem of scan.problems) {
      assert.match(problem, /cannot be read: invalid JSON/);
      assert.match(problem, /left unchanged/);
    }

    // The damaged files themselves stay byte-identical: nothing is rewritten or deleted.
    assert.equal(await readFile(runFile(cwd, "corrupt-run"), "utf8"), "not json");
    assert.equal(await readFile(runFile(cwd, "truncated-run"), "utf8"), '{"runId":"truncated-run","playbookId":"feature"');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadRunSafe returns the path for a corrupt file and loadRun fails with the friendly message", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-load-run-"));
  try {
    await mkdir(join(cwd, ".pi", "playbook-runs"), { recursive: true });
    await writeFile(runFile(cwd, "broken-run"), "not valid json", "utf8");

    assert.deepEqual(await loadRunSafe(cwd, "missing-run"), { run: undefined });
    const safe = await loadRunSafe(cwd, "broken-run");
    assert.equal(safe.path, runFile(cwd, "broken-run"));
    assert.ok(safe.error);
    assert.match(safe.error.message, /broken-run\.json/);
    assert.match(safe.error.message, /invalid JSON/);

    await assert.rejects(() => loadRun(cwd, "broken-run"), (error: Error) => {
      assert.match(error.message, /broken-run\.json/);
      assert.match(error.message, /invalid JSON/);
      assert.doesNotMatch(error.message, /Unexpected token/);
      return true;
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("corrupt active pointer is reported without throwing and nothing is cleared", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-corrupt-active-"));
  try {
    await mkdir(join(cwd, ".pi", "playbook-runs"), { recursive: true });
    await writeFile(activeFile(cwd), "{oops", "utf8");

    assert.deepEqual(await loadActiveRunIdSafe(cwd), {
      problem: `Playbook state file "${activeFile(cwd)}" cannot be read: invalid JSON. The file was left unchanged; repair or delete it.`,
    });
    await assert.rejects(() => loadActiveRunId(cwd), SyntaxError);
    assert.equal(await readFile(activeFile(cwd), "utf8"), "{oops");
    assert.deepEqual(await scanRuns(cwd), { runs: [], problems: [] });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadActiveRunIdSafe ignores a pointer with no usable runId", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-active-shape-"));
  try {
    await mkdir(join(cwd, ".pi", "playbook-runs"), { recursive: true });
    await writeFile(activeFile(cwd), '{"runId":42}', "utf8");
    assert.deepEqual(await loadActiveRunIdSafe(cwd), {});
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

function run(runId: string, status: PlaybookRunState["status"]): PlaybookRunState {
  const now = "2026-06-01T00:00:00.000Z";
  return {
    runId,
    playbookId: "feature-development",
    playbookPath: ".pi/playbooks/feature-development.yml",
    currentStep: "grill",
    status,
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}
