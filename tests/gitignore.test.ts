import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  GITIGNORE_SNIPPET,
  getGitignoreAdvisory,
  isPlaybookRecordsGitignored,
  isPlaybookRunsGitignored,
} from "../src/gitignore.js";

test("isPlaybookRunsGitignored detects common ignore patterns", () => {
  assert.equal(isPlaybookRunsGitignored(".pi/playbook-runs/\n"), true);
  assert.equal(isPlaybookRunsGitignored(".pi/playbook-runs\n"), true);
  assert.equal(isPlaybookRunsGitignored("/.pi/playbook-runs/\n"), true);
  assert.equal(isPlaybookRunsGitignored(".pi/playbook-runs/**\n"), true);
  assert.equal(isPlaybookRunsGitignored(".pi/\n"), true);
  assert.equal(isPlaybookRunsGitignored("# comment\n.pi/playbook-runs/\n"), true);
  assert.equal(isPlaybookRunsGitignored("node_modules/\n"), false);
});

test("isPlaybookRunsGitignored respects later negation rules", () => {
  assert.equal(
    isPlaybookRunsGitignored(".pi/\n!.pi/playbook-runs/\n"),
    false,
  );
  assert.equal(
    isPlaybookRunsGitignored("!.pi/playbook-runs/\n.pi/playbook-runs/\n"),
    true,
  );
});

test("isPlaybookRecordsGitignored detects common ignore patterns", () => {
  assert.equal(isPlaybookRecordsGitignored(".pi/playbook-records/\n"), true);
  assert.equal(isPlaybookRecordsGitignored(".pi/\n"), true);
  assert.equal(isPlaybookRecordsGitignored("node_modules/\n"), false);
});

test("getGitignoreAdvisory returns undefined when run and record state are gitignored", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-gitignore-ignored-"));
  try {
    await writeFile(
      join(cwd, ".gitignore"),
      ".pi/playbook-runs/\n.pi/playbook-records/\n",
      "utf8",
    );
    assert.equal(await getGitignoreAdvisory(cwd), undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("getGitignoreAdvisory returns records snippet when only run state is gitignored", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-gitignore-records-missing-"));
  try {
    await writeFile(join(cwd, ".gitignore"), ".pi/playbook-runs/\n", "utf8");
    const advisory = await getGitignoreAdvisory(cwd);
    assert.match(advisory ?? "", /playbook-records/);
    assert.doesNotMatch(advisory ?? "", /playbook-runs/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("getGitignoreAdvisory returns snippet when run state is not gitignored", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-gitignore-missing-"));
  try {
    const advisory = await getGitignoreAdvisory(cwd);
    assert.match(advisory ?? "", /Run state is personal/);
    assert.match(advisory ?? "", new RegExp(GITIGNORE_SNIPPET.replace("/", "\/")));
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
    assert.match(advisory ?? "", new RegExp(GITIGNORE_SNIPPET.replace("/", "\/")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("getGitignoreAdvisory returns snippet when .pi is ignored but playbook-runs is re-included", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-gitignore-negated-"));
  try {
    await writeFile(join(cwd, ".gitignore"), ".pi/\n!.pi/playbook-runs/\n", "utf8");
    const advisory = await getGitignoreAdvisory(cwd);
    assert.match(advisory ?? "", /Run state is personal/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
