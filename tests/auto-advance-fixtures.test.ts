import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { processAgentCompletionForTest } from "../extensions/index.js";
import { loadActiveRunId, loadRun, saveRun, setActiveRun } from "../src/state.js";
import {
  assertPlanMatches,
  assertPromptMatches,
  evaluateScenario,
  loadAutoAdvanceScenarios,
  loadFixturePlaybook,
  planMutatesState,
  type AutoAdvanceScenario,
} from "./helpers/auto-advance-fixtures.js";

const basePlaybook = loadFixturePlaybook();
const scenarios = loadAutoAdvanceScenarios();

for (const scenario of scenarios) {
  test(`auto-advance fixture: ${scenario.id}`, () => {
    const result = evaluateScenario(basePlaybook, scenario);

    assertPlanMatches(result.plan, scenario.expect.plan, scenario.id);
    assertPromptMatches(result.prompt, scenario.expect.prompt, scenario.id);
    assert.equal(
      planMutatesState(result.plan),
      scenario.expect.mutatesState,
      `${scenario.id}: mutatesState mismatch (plan.kind=${result.plan?.kind ?? "none"})`,
    );
  });
}

test("fixture catalog covers auto, suggest, and off advance modes", () => {
  const modes = new Set(scenarios.map((scenario) => scenario.autoAdvance ?? "auto"));
  assert.ok(modes.has("auto"), "missing auto mode scenario");
  assert.ok(modes.has("suggest"), "missing suggest mode scenario");
  assert.ok(modes.has("off"), "missing off mode scenario");
});

test("fixture catalog covers marker edge cases", () => {
  const ids = new Set(scenarios.map((scenario) => scenario.id));
  assert.ok(ids.has("missing-marker-suggest-only"), "missing markerless scenario");
  assert.ok(ids.has("wrong-skill-with-marker"), "missing wrong-skill scenario");
  assert.ok(ids.has("multi-outcome-with-marker"), "missing multi-outcome scenario");
  assert.ok(ids.has("invalid-marker-outcome"), "missing invalid-marker scenario");
});

const noMutationScenarios = scenarios.filter((scenario) => !scenario.expect.mutatesState);

for (const scenario of noMutationScenarios) {
  test(`auto-advance fixture state: ${scenario.id} does not mutate run`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-auto-advance-fixture-"));
    try {
      await writePlaybookYaml(cwd, basePlaybook, scenario);
      const { run, invokedSkill } = evaluateScenario(basePlaybook, scenario);
      const before = structuredClone(run);
      await saveRun(cwd, run);
      await setActiveRun(cwd, run.runId);

      const ui = new MockUi();
      await processAgentCompletionForTest(cwd, invokedSkill, scenario.turn.assistantText, ui);

      const after = await loadRun(cwd, run.runId);
      assert.deepEqual(after, before, `${scenario.id}: run state must not change`);
      assert.equal(await loadActiveRunId(cwd), run.runId);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

const mutationScenarios = scenarios.filter((scenario) => scenario.expect.mutatesState);

for (const scenario of mutationScenarios) {
  test(`auto-advance fixture state: ${scenario.id} advances run`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-auto-advance-fixture-"));
    try {
      await writePlaybookYaml(cwd, basePlaybook, scenario);
      const { run, invokedSkill } = evaluateScenario(basePlaybook, scenario);
      await saveRun(cwd, run);
      await setActiveRun(cwd, run.runId);

      const ui = new MockUi();
      await processAgentCompletionForTest(cwd, invokedSkill, scenario.turn.assistantText, ui);

      const after = await loadRun(cwd, run.runId);
      assert.ok(after, `${scenario.id}: run should still exist`);

      if (scenario.expect.plan?.to === "complete") {
        assert.equal(after!.status, "completed", `${scenario.id}: run should complete`);
        assert.equal(after!.history.length, run.history.length + 1);
        assert.equal(await loadActiveRunId(cwd), undefined);
      } else {
        assert.equal(
          after!.currentStep,
          scenario.expect.plan?.to,
          `${scenario.id}: currentStep should match expected plan.to`,
        );
        assert.equal(after!.history.length, run.history.length + 1);
        assert.equal(
          await loadActiveRunId(cwd),
          run.runId,
          `${scenario.id}: active run must remain unchanged`,
        );
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

async function writePlaybookYaml(
  cwd: string,
  playbook: typeof basePlaybook,
  scenario?: AutoAdvanceScenario,
): Promise<void> {
  const dir = join(cwd, ".pi/playbooks");
  await mkdir(dir, { recursive: true });
  const autoAdvance = scenario?.autoAdvance;
  const yaml = [
    "version: 1",
    `id: ${playbook.definition.id}`,
    `name: ${playbook.definition.name}`,
    `entry: ${playbook.definition.entry}`,
    ...(autoAdvance ? [`autoAdvance: ${autoAdvance}`] : []),
    "skills:",
    ...Object.entries(playbook.definition.skills).map(([name, skill]) => `  ${name}:\n    role: ${skill.role}`),
    "steps:",
    ...Object.entries(playbook.definition.steps).flatMap(([stepId, step]) => [
      `  ${stepId}:`,
      `    primarySkill: ${step.primarySkill}`,
      `    commandHint: ${JSON.stringify(step.commandHint)}`,
      "    doneWhen:",
      ...step.doneWhen.map((item) => `      - ${JSON.stringify(item)}`),
      step.transitions.length === 0
        ? "    transitions: []"
        : "    transitions:",
      ...(step.transitions.length === 0
        ? []
        : step.transitions.flatMap((transition) => [
            "      -",
            `        outcome: ${transition.outcome}`,
            `        to: ${transition.to}`,
          ])),
    ]),
  ].join("\n");
  await writeFile(join(dir, "fixture-playbook.yml"), `${yaml}\n`, "utf8");
}

class MockUi {
  notifications: Array<{ message: string; level: "info" | "warning" | "error" }> = [];

  notify(message: string, level: "info" | "warning" | "error") {
    this.notifications.push({ message, level });
  }

  setWidget() {}
}
