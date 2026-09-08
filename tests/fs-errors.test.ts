import test from "node:test";
import assert from "node:assert/strict";
import { isNotFound } from "../src/fs-errors.js";

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
