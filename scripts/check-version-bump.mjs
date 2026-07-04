#!/usr/bin/env node
/**
 * PR guard for versioned source changes.
 *
 * Rules:
 * - PRs touching versioned runtime source paths must bump package.json version.
 * - Any version bump must increase SemVer and update CHANGELOG.md.
 * - Major version bumps require explicit human approval.
 *
 * Usage:
 *   node scripts/check-version-bump.mjs
 *   BASE_REF=origin/main node scripts/check-version-bump.mjs
 *   ALLOW_MAJOR_VERSION_BUMP=1 BASE_REF=origin/main node scripts/check-version-bump.mjs
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const VERSIONED_PATHS = ["extensions/", "src/"];

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a, b) {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) {
    throw new Error(`Invalid SemVer comparison: ${a} vs ${b}`);
  }
  for (let index = 0; index < 3; index += 1) {
    if (parsedA[index] !== parsedB[index]) return parsedA[index] - parsedB[index];
  }
  return 0;
}

function readPackageVersion(ref) {
  const raw = ref ? run(`git show ${ref}:package.json`) : readFileSync("package.json", "utf8");
  return JSON.parse(raw).version;
}

function hasMajorApproval() {
  if (process.env.ALLOW_MAJOR_VERSION_BUMP === "1") return true;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return false;
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    const pr = event.pull_request ?? {};
    const haystack = `${pr.title ?? ""}\n${pr.body ?? ""}`.toLowerCase();
    return haystack.includes("major-approved");
  } catch {
    return false;
  }
}

function isVersionedPath(file) {
  return VERSIONED_PATHS.some((path) => file === path || file.startsWith(path));
}

const baseRef = process.env.BASE_REF ?? "origin/main";

let changed;
try {
  run(`git rev-parse --verify ${baseRef}`);
  changed = run(`git diff --name-only ${baseRef}...HEAD`).split("\n").filter(Boolean);
} catch {
  console.log("version:check skip - base ref not available (local run?)");
  process.exit(0);
}

const baseVersion = readPackageVersion(baseRef);
const headVersion = readPackageVersion();
let versionDelta;
try {
  versionDelta = compareSemver(headVersion, baseVersion);
} catch (error) {
  console.error(`version:check fail - ${error.message}`);
  process.exit(1);
}

if (versionDelta < 0) {
  console.error(`version:check fail - package.json version went backwards (${baseVersion} -> ${headVersion}).`);
  process.exit(1);
}

const versionedChanged = changed.some(isVersionedPath);

if (versionedChanged && versionDelta === 0) {
  console.error(
    `version:check fail - changes under ${VERSIONED_PATHS.join(", ")} require a package.json version bump and CHANGELOG.md entry.`,
  );
  process.exit(1);
}

if (versionDelta > 0) {
  const [baseMajor] = parseSemver(baseVersion);
  const [headMajor] = parseSemver(headVersion);
  if (headMajor > baseMajor && !hasMajorApproval()) {
    console.error(
      "version:check fail - major version bump requires explicit human approval. Add 'major-approved' to the PR title/body or rerun locally with ALLOW_MAJOR_VERSION_BUMP=1.",
    );
    process.exit(1);
  }
  if (!changed.includes("CHANGELOG.md")) {
    console.error("version:check fail - version bumped, but CHANGELOG.md was not updated in this PR.");
    process.exit(1);
  }
  console.log(`version:check ok - ${baseVersion} -> ${headVersion}, CHANGELOG.md updated`);
  process.exit(0);
}

console.log("version:check ok - no versioned source change requires a bump");
