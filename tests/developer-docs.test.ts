import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
const ciWorkflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

test("README documents npm run ci as the full validation entrypoint", () => {
  const developmentSection = readme.slice(readme.indexOf("## Development"));
  assert.match(developmentSection, /npm run ci/);
  assert.match(developmentSection, /npm run check/);
  assert.match(developmentSection, /npm test/);
});

test("package.json engines.node matches CI node-version", () => {
  const workflowNodeVersion = /node-version:\s*(\d+)/.exec(ciWorkflow)?.[1];
  assert.ok(workflowNodeVersion, "ci.yml must declare node-version");

  const enginesNode = packageJson.engines?.node;
  assert.ok(enginesNode, "package.json must declare engines.node");
  assert.match(enginesNode, new RegExp(`>=?${workflowNodeVersion}`));
});

test("package.json ci script matches documented validation steps", () => {
  const ciScript = packageJson.scripts.ci;
  assert.match(ciScript, /typecheck/);
  assert.match(ciScript, /test/);
  assert.match(ciScript, /validate:package/);
  assert.match(ciScript, /actions:check/);
});
