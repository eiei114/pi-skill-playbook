import test from "node:test";
import assert from "node:assert/strict";
import { renderStepCard } from "../src/render.js";
import type { LoadedPlaybook, PlaybookRunState } from "../src/types.js";

function createStepCardFixture() {
  const playbook: LoadedPlaybook = {
    path: "feature.yml",
    definition: {
      version: 1,
      id: "feature-development",
      name: "Feature Development Playbook",
      entry: "grill",
      skills: { "grill-with-docs": { role: "entry" } },
      steps: {
        grill: {
          primarySkill: "grill-with-docs",
          commandHint: "/skill:grill-with-docs <feature idea>",
          doneWhen: ["Problem boundary is clear."],
          transitions: [{ outcome: "ready-for-prd", to: "prd" }],
        },
      },
    },
  };
  const run: PlaybookRunState = {
    runId: "run-1",
    playbookId: "feature-development",
    playbookPath: "feature.yml",
    currentStep: "grill",
    status: "active",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    history: [],
  };
  return { playbook, run };
}

test("renders a Step Card", () => {
  const { playbook, run } = createStepCardFixture();
  const lines = renderStepCard(playbook, run);
  assert.deepEqual(lines.slice(0, 4), [
    "Playbook: Feature Development Playbook",
    "Run: run-1",
    "Step: grill",
    "Next: /skill:grill-with-docs <feature idea>",
  ]);
  assert.equal(lines.at(-1), "Outcomes: ready-for-prd -> prd");
});

test("renders completion without a next step, even if the saved step is missing", () => {
  const { playbook, run } = createStepCardFixture();

  for (const currentStep of ["grill", "removed-step"]) {
    assert.deepEqual(
      renderStepCard(playbook, { ...run, status: "completed", currentStep }),
      ["Playbook complete: Feature Development Playbook", "Run: run-1"],
      `saved step: ${currentStep}`,
    );
  }
});

test("renders a missing-step diagnostic instead of a command for an active run", () => {
  const { playbook, run } = createStepCardFixture();

  assert.deepEqual(renderStepCard(playbook, { ...run, currentStep: "removed-step" }), [
    "Playbook error: Feature Development Playbook",
    "Run: run-1",
    "Missing step: removed-step",
  ]);
});
