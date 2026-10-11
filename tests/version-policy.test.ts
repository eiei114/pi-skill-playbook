import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/check-version-bump.mjs", import.meta.url));
const fixture = new URL("./fixtures/github-pr-fetch.mjs", import.meta.url).href;

function check({ event = {}, version = "1.2.3", scenario = "no-release", overrides = {} }: {
  event?: unknown; version?: string; scenario?: string; overrides?: Record<string, string>;
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "playbook-version-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    fs.writeFileSync(path.join(root, "src", "feature.ts"), "export const value = 1;\n");
    git("add", "."); git("commit", "-qm", "base"); const base = git("rev-parse", "HEAD");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }));
    fs.writeFileSync(path.join(root, "src", "feature.ts"), "export const value = 2;\n");
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), "Fixture change\n");
    git("add", "."); git("commit", "-qm", "head");
    const eventPath = path.join(root, "event.json"); fs.writeFileSync(eventPath, JSON.stringify(event));
    const env = { ...process.env, BASE_REF: base, GITHUB_EVENT_PATH: eventPath,
      GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/42/merge", GITHUB_REPOSITORY: "example/project",
      GITHUB_TOKEN: "fixture-token", GITHUB_API_URL: "https://api.github.com", ALLOW_MAJOR_VERSION_BUMP: "",
      PR_FETCH_FIXTURE: scenario, ...overrides };
    return spawnSync(process.execPath, ["--import", fixture, script], { cwd: root, env, encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("fork payload without body still honors authenticated Release: none", () => {
  const result = check();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no release declared/);
});

test("Release: none still rejects a version increase through API or event body", () => {
  for (const event of [{}, { pull_request: { body: "Release: none" } }]) {
    const result = check({ event, version: "1.2.4" });
    assert.equal(result.status, 1); assert.match(result.stderr, /conflicts with.*version bump/);
  }
});

test("ordinary version increase with changelog remains valid", () => {
  const result = check({ scenario: "ordinary", version: "1.2.4" });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /CHANGELOG.md updated/);
});

test("empty event body is authoritative and cannot be replaced by an API declaration", () => {
  const result = check({ event: { pull_request: { body: "" } } });
  assert.equal(result.status, 1); assert.match(result.stderr, /require a package.json version bump/);
});

test("API denial, malformed/oversized response, outage and absent declaration fail closed", () => {
  for (const scenario of ["denied", "invalid", "oversize", "offline", "ordinary"]) {
    const result = check({ scenario });
    assert.equal(result.status, 1, scenario); assert.match(result.stderr, /require a package.json version bump/);
    assert.doesNotMatch(result.stderr, /fixture-token/);
  }
});

test("untrusted API origins, non-PR refs/events and missing read token cannot authorize no release", () => {
  const cases: Record<string, string>[] = [{ GITHUB_API_URL: "https://untrusted.invalid" }, { GITHUB_REF: "refs/heads/main" },
    { GITHUB_EVENT_NAME: "push" }, { GITHUB_TOKEN: "" }, { GITHUB_REPOSITORY: "../project" }];
  for (const overrides of cases) {
    assert.equal(check({ overrides }).status, 1);
  }
});

test("API fallback does not grant major approval", () => {
  const result = check({ scenario: "ordinary", version: "2.0.0" });
  assert.equal(result.status, 1); assert.match(result.stderr, /major version bump requires explicit human approval/);
});
