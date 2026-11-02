import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { clearActiveId, loadActiveId, saveActiveId } from "../src/active-state.js";

test("active id persistence shares JSON format and tolerates missing files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-active-state-"));
  const path = join(cwd, "nested", "active.json");
  try {
    assert.equal(await loadActiveId(path, "runId"), undefined);
    await saveActiveId(path, "runId", "run-1");
    assert.equal(await readFile(path, "utf8"), '{\n  "runId": "run-1"\n}\n');
    assert.equal(await loadActiveId(path, "runId"), "run-1");
    assert.equal(await loadActiveId(path, "sessionId", (id) => id.startsWith("record-")), undefined);

    await clearActiveId(path);
    assert.equal(await loadActiveId(path, "runId"), undefined);
    await clearActiveId(path);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("active id validation remains caller-specific and parse errors remain visible", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-active-state-validation-"));
  const path = join(cwd, "active.json");
  try {
    await writeFile(path, '{"sessionId":"record-flow-123"}', "utf8");
    assert.equal(await loadActiveId(path, "sessionId", (id) => /^record-[a-z0-9][a-z0-9-]*-\d+$/.test(id)), "record-flow-123");
    assert.equal(await loadActiveId(path, "sessionId", (id) => id === "other"), undefined);

    await writeFile(path, "not json", "utf8");
    await assert.rejects(() => loadActiveId(path, "sessionId"), SyntaxError);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
