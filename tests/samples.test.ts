import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parsePlaybookYaml, validatePlaybook, validateUniquePlaybookIds } from "../src/validation.js";

const VAULT_OSS_SKILLS = new Set([
  "grill-with-docs",
  "to-prd",
  "to-issues",
  "to-prd-for-oss",
  "to-issues-for-oss",
  "tdd",
  "review",
  "pi-extension-pr-verify",
  "x-release-post",
  "pi-oss-bootstrap",
  "oss-maintenance-onboarding",
]);

const samplesDir = join(import.meta.dirname, "..", "samples");

function loadSamples() {
  return readdirSync(samplesDir)
    .filter((name) => name.endsWith(".yml"))
    .map((name) => {
      const path = join(samplesDir, name);
      const source = readFileSync(path, "utf8");
      return parsePlaybookYaml(source, path);
    });
}

test("package samples pass strict schema validation", () => {
  const samples = loadSamples();
  const unique = validateUniquePlaybookIds(samples);
  assert.equal(unique.valid, true, unique.errors.join("\n"));

  for (const sample of samples) {
    const result = validatePlaybook(sample, VAULT_OSS_SKILLS, { requireSkills: true });
    assert.equal(result.valid, true, `${sample.path}: ${result.errors.join("; ")}`);
  }
});

test("Pi OSS samples use -for-oss skills where applicable", () => {
  const samples = loadSamples();
  const byId = new Map(samples.map((sample) => [sample.definition.id, sample]));

  const bootstrap = byId.get("pi-oss-bootstrap-only");
  assert.ok(bootstrap);
  assert.ok(bootstrap.definition.skills?.["to-prd-for-oss"]);
  assert.ok(bootstrap.definition.skills?.["to-issues-for-oss"]);

  const delivery = byId.get("pi-oss-new");
  assert.ok(delivery);
  assert.ok(delivery.definition.skills?.["to-prd-for-oss"]);
  assert.ok(delivery.definition.skills?.["to-issues-for-oss"]);
  assert.equal(delivery.definition.skills?.["to-prd"], undefined);
  assert.equal(delivery.definition.skills?.["to-issues"], undefined);
});
