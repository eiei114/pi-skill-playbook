import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const repoRoot = join(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
const ciWorkflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
const publishWorkflow = readFileSync(join(repoRoot, ".github/workflows/publish.yml"), "utf8");

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

function collectCheckoutRefs(value: unknown, refs: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCheckoutRefs(item, refs);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "uses" && typeof child === "string") {
      const match = /^actions\/checkout@(.+)$/i.exec(child.trim());
      if (match) {
        refs.push(match[1].trim());
      }
    } else {
      collectCheckoutRefs(child, refs);
    }
  }
}

function extractCheckoutRefsFromWorkflowYaml(source: string): string[] {
  const refs: string[] = [];
  collectCheckoutRefs(parse(source), refs);
  return refs;
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

test("README CI badge links to ci.yml workflow", () => {
  const ciBadgePattern =
    /\[!\[CI\]\(https:\/\/github\.com\/eiei114\/pi-skill-playbook\/actions\/workflows\/ci\.yml\/badge\.svg\)\]\(https:\/\/github\.com\/eiei114\/pi-skill-playbook\/actions\/workflows\/ci\.yml\)/;
  assert.match(readme, ciBadgePattern, "README CI badge must point to ci.yml, not auto-release.yml");
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

test("package.json files includes CHANGELOG and SECURITY for npm pack", () => {
  const output = execSync("npm pack --dry-run --json", {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const packs = JSON.parse(output) as Array<{ files: Array<{ path: string }> }>;
  assert.equal(packs.length, 1, "npm pack --dry-run --json should return one package");
  const paths = packs[0].files.map((file) => file.path);
  assert.ok(paths.includes("CHANGELOG.md"), "npm pack manifest must ship CHANGELOG.md");
  assert.ok(paths.includes("SECURITY.md"), "npm pack manifest must ship SECURITY.md");
});

test("publish workflow runs npm run ci before npm publish", () => {
  const validationIndex = publishWorkflow.indexOf("run: npm run ci");
  const publishIndex = publishWorkflow.indexOf("run: npm publish --access public");

  assert.ok(validationIndex >= 0, "publish workflow should run npm run ci");
  assert.ok(publishIndex >= 0, "publish workflow should run npm publish");
  assert.ok(
    validationIndex < publishIndex,
    "publish workflow must validate before publishing",
  );
});

test("checkout SHA scan ignores uses-like text inside run block scalars", () => {
  const fixturePath = join(repoRoot, "tests/fixtures/workflows/block-scalar-false-positive.yml");
  const refs = extractCheckoutRefsFromWorkflowYaml(readFileSync(fixturePath, "utf8"));
  assert.deepEqual(refs, ["df4cb1c069e1874edd31b4311f1884172cec0e10"]);
});

test("workflows pin actions/checkout to a single immutable SHA", () => {
  const workflowDir = join(repoRoot, ".github/workflows");
  const shas = new Set<string>();
  const invalidRefs: string[] = [];

  for (const file of readdirSync(workflowDir).sort()) {
    if (!/\.ya?ml$/i.test(file)) continue;
    const content = readFileSync(join(workflowDir, file), "utf8");
    for (const ref of extractCheckoutRefsFromWorkflowYaml(content)) {
      if (/^[0-9a-f]{40}$/i.test(ref)) {
        shas.add(ref.toLowerCase());
      } else {
        invalidRefs.push(`${file}: actions/checkout@${ref}`);
      }
    }
  }

  assert.equal(
    invalidRefs.length,
    0,
    `actions/checkout must use immutable 40-char SHAs, found: ${invalidRefs.join(", ")}`,
  );
  assert.equal(shas.size, 1, `expected one checkout SHA across workflows, found: ${[...shas].join(", ")}`);
});
