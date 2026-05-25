import test from "node:test";
import assert from "node:assert/strict";
import { renderStepCard } from "../src/render.js";
import type { LoadedPlaybook, PlaybookRunState } from "../src/types.js";

test("renders a Step Card", () => {
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

  const lines = renderStepCard(playbook, run);
  assert.deepEqual(lines.slice(0, 4), [
    "Playbook: Feature Development Playbook",
    "Run: run-1",
    "Step: grill",
    "Next: /skill:grill-with-docs <feature idea>",
  ]);
  assert.equal(lines.at(-1), "Outcomes: ready-for-prd -> prd");
});
