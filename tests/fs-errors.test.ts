import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isNotFound, readJsonIfExists } from "../src/fs-errors.js";

test("isNotFound recognizes ENOENT errors", () => {
  assert.equal(isNotFound(Object.assign(new Error("missing"), { code: "ENOENT" })), true);
  assert.equal(isNotFound({ code: "ENOENT" }), true);
});

test("isNotFound rejects non-ENOENT errors", () => {
  assert.equal(isNotFound(Object.assign(new Error("permission"), { code: "EACCES" })), false);
  assert.equal(isNotFound(new Error("plain")), false);
  assert.equal(isNotFound(null), false);
  assert.equal(isNotFound(undefined), false);
});

test("readJsonIfExists shares missing-file handling without hiding parse errors", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-fs-errors-"));
  try {
    assert.equal(await readJsonIfExists(join(cwd, "missing.json")), undefined);
    const path = join(cwd, "valid.json");
    await writeFile(path, '{"runId":"run-1"}', "utf8");
    assert.deepEqual(await readJsonIfExists<{ runId: string }>(path), { runId: "run-1" });
    await writeFile(path, "not json", "utf8");
    await assert.rejects(() => readJsonIfExists(path), SyntaxError);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
