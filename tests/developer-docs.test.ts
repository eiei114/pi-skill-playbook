import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
const ciWorkflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

type NodeVersion = [major: number, minor: number, patch: number];

function parseNodeVersion(version: string): NodeVersion {
  const [major, minor = "0", patch = "0"] = version.split(".");
  return [Number(major), Number(minor), Number(patch)];
}

function compareNodeVersions(left: NodeVersion, right: NodeVersion): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function satisfiesNodeRange(range: string, version: string): boolean {
  const target = parseNodeVersion(version);
  const greaterThanOrEqual = /^>=(\d+(?:\.\d+){0,2})$/.exec(range);
  if (greaterThanOrEqual) {
    return compareNodeVersions(target, parseNodeVersion(greaterThanOrEqual[1])) >= 0;
  }

  const greaterThan = /^>(\d+(?:\.\d+){0,2})$/.exec(range);
  if (greaterThan) {
    return compareNodeVersions(target, parseNodeVersion(greaterThan[1])) > 0;
  }

  return false;
}

function extractDevelopmentSection(markdown: string): string {
  const start = markdown.indexOf("## Development");
  assert.ok(start >= 0, "README must include a Development section");
  const end = markdown.indexOf("\n## ", start + 1);
  return end === -1 ? markdown.slice(start) : markdown.slice(start, end);
}

test("README documents npm run ci as the full validation entrypoint", () => {
  const developmentSection = extractDevelopmentSection(readme);
  assert.match(developmentSection, /npm run ci/);
  assert.match(developmentSection, /npm run check/);
  assert.match(developmentSection, /npm test/);
});

test("package.json engines.node matches CI node-version", () => {
  const workflowNodeVersion = /node-version:\s*(\d+)/.exec(ciWorkflow)?.[1];
  assert.ok(workflowNodeVersion, "ci.yml must declare node-version");

  const enginesNode = packageJson.engines?.node;
  assert.ok(enginesNode, "package.json must declare engines.node");

  const ciVersion = `${workflowNodeVersion}.0.0`;
  assert.ok(
    satisfiesNodeRange(enginesNode, ciVersion),
    `engines.node (${enginesNode}) must accept CI Node ${workflowNodeVersion}`,
  );
  assert.ok(
    !satisfiesNodeRange(enginesNode, `${Number(workflowNodeVersion) - 1}.99.99`),
    `engines.node (${enginesNode}) must reject Node versions below CI`,
  );
});

test("package.json ci script matches documented validation steps", () => {
  const ciScript = packageJson.scripts.ci;
  assert.match(ciScript, /typecheck/);
  assert.match(ciScript, /test/);
  assert.match(ciScript, /validate:package/);
  assert.match(ciScript, /actions:check/);
});
