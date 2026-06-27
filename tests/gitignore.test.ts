import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GITIGNORE_SNIPPET, getGitignoreAdvisory, isPlaybookRunsGitignored } from "../src/gitignore.js";

test("isPlaybookRunsGitignored detects common ignore patterns", () => {
  assert.equal(isPlaybookRunsGitignored(".pi/playbook-runs/\n"), true);
  assert.equal(isPlaybookRunsGitignored(".pi/playbook-runs\n"), true);
  assert.equal(isPlaybookRunsGitignored("/.pi/playbook-runs/\n"), true);
  assert.equal(isPlaybookRunsGitignored(".pi/playbook-runs/**\n"), true);
  assert.equal(isPlaybookRunsGitignored(".pi/\n"), true);
  assert.equal(isPlaybookRunsGitignored("# comment\n.pi/playbook-runs/\n"), true);
  assert.equal(isPlaybookRunsGitignored("node_modules/\n"), false);
});

test("getGitignoreAdvisory returns undefined when run state is gitignored", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-gitignore-ignored-"));
  try {
    await writeFile(join(cwd, ".gitignore"), ".pi/playbook-runs/\n", "utf8");
    assert.equal(await getGitignoreAdvisory(cwd), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("getGitignoreAdvisory returns snippet when run state is not gitignored", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-gitignore-missing-"));
  try {
    const advisory = await getGitignoreAdvisory(cwd);
    assert.match(advisory ?? "", /Run state is personal/);
    assert.match(advisory ?? "", new RegExp(GITIGNORE_SNIPPET.replace("/", "\\/")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("getGitignoreAdvisory returns snippet when .gitignore omits run state", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-gitignore-other-"));
  try {
    await writeFile(join(cwd, ".gitignore"), "node_modules/\n", "utf8");
    const advisory = await getGitignoreAdvisory(cwd);
    assert.match(advisory ?? "", /Add this to \.gitignore/);
    assert.match(advisory ?? "", new RegExp(GITIGNORE_SNIPPET.replace("/", "\\/")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
