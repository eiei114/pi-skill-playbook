import test from "node:test";
import assert from "node:assert/strict";
import { parsePlaybookYaml, validatePlaybook } from "../src/validation.js";

const validYaml = `
version: 1
id: feature-development
name: Feature Development Playbook
entry: grill
skills:
  grill-with-docs:
    role: entry
  to-prd:
    role: internal
steps:
  grill:
    primarySkill: grill-with-docs
    commandHint: "/skill:grill-with-docs <feature idea>"
    doneWhen:
      - Problem boundary is clear.
    transitions:
      - outcome: ready-for-prd
        to: prd
  prd:
    primarySkill: to-prd
    commandHint: "/skill:to-prd create PRD"
    doneWhen:
      - PRD exists.
    transitions:
      - outcome: done
        to: complete
`;

test("validates a strict playbook", () => {
  const playbook = parsePlaybookYaml(validYaml, "feature.yml");
  const result = validatePlaybook(playbook, new Set(["grill-with-docs", "to-prd"]), { requireSkills: true });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("blocks missing transition targets", () => {
  const playbook = parsePlaybookYaml(validYaml.replace("to: prd", "to: missing"), "feature.yml");
  const result = validatePlaybook(playbook);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /targets missing step 'missing'/);
});

test("blocks unavailable primary skills when required", () => {
  const playbook = parsePlaybookYaml(validYaml, "feature.yml");
  const result = validatePlaybook(playbook, new Set(["grill-with-docs"]), { requireSkills: true });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /primarySkill 'to-prd' is not an available Agent Skill/);
});
