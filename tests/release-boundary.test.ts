import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = (name: string) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
// Limited regression contract. Unknown syntax fails, not a general YAML parser.
function events(text: string) {
  assert.equal([...text.matchAll(/^on:/gm)].length, 1);
  const match = /^on:\s*\r?\n([\s\S]*?)(?=^[a-zA-Z][\w-]*:|$(?![\s\S]))/m.exec(text);
  assert.ok(match, "block-form trigger required");
  return match[1].split(/\r?\n/).filter((line) => /^  \S/.test(line) && !/^  #/.test(line)).map((line) => {
    const event = /^  ([a-z_]+):\s*(?:#.*)?$/.exec(line);
    assert.ok(event, "unknown trigger syntax"); return event[1];
  });
}
function releaseSafe(text: string) {
  assert.deepEqual(events(text), ["workflow_dispatch"]);
  assert.match(text, /^    if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'\s*$/m);
  assert.match(text, /gh release create/); assert.match(text, /gh workflow run publish\.yml/);
}
test("ordinary main merge cannot create tags/releases or dispatch publishing", () => releaseSafe(workflow("auto-release.yml")));
test("restored main push, unknown trigger or missing manual-main guard fails closed", () => {
  const text = workflow("auto-release.yml");
  for (const changed of [text.replace("  workflow_dispatch:", "  push:\n    branches: [main]"),
    text.replace("  workflow_dispatch:", "  workflow_run:"), text.replace(/^on:\r?\n/m, "on: [push]\n"),
    text.replace(/^    if:.*\r?\n/m, "")]) assert.throws(() => releaseSafe(changed));
});
test("protected tag/release/manual publishing, OIDC and version skip remain", () => {
  const text = workflow("publish.yml");
  assert.deepEqual(events(text), ["push", "release", "workflow_dispatch"]);
  assert.match(text, /    tags:\s*\r?\n      - 'v\*\.\*\.\*'/);
  assert.match(text, /^  id-token: write\s*$/m);
  assert.match(text, /steps\.published\.outputs\.skip != 'true'/);
});
test("CI declaration fallback gets only a read token in the version-check step", () => {
  const text = workflow("ci.yml");
  assert.match(text, /^  contents: read\s*$/m); assert.match(text, /^  pull-requests: read\s*$/m);
  assert.match(text, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/); assert.doesNotMatch(text, /pull_request_target:|contents: write|pull-requests: write/);
});
