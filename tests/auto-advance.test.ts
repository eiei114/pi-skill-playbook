import test from "node:test";
import assert from "node:assert/strict";
import { lastAssistantText, parseOutcomeMarker, parseSkillInvocation, planCompletion, renderPlaybookPrompt } from "../src/auto-advance.js";
import type { LoadedPlaybook, PlaybookRunState } from "../src/types.js";

function playbook(overrides: Partial<LoadedPlaybook["definition"]> = {}): LoadedPlaybook {
  return {
    path: "feature.yml",
    definition: {
      version: 1,
      id: "feature-development",
      name: "Feature Development Playbook",
      entry: "grill",
      skills: { "grill-with-docs": { role: "entry" }, review: { role: "internal" } },
      steps: {
        grill: {
          primarySkill: "grill-with-docs",
          commandHint: "/skill:grill-with-docs <feature idea>",
          doneWhen: ["Problem boundary is clear."],
          transitions: [{ outcome: "ready-for-prd", to: "prd" }],
        },
        review: {
          primarySkill: "review",
          commandHint: "/skill:review review this branch",
          doneWhen: ["Review result is known."],
          transitions: [{ outcome: "pass", to: "complete" }, { outcome: "fail", to: "grill" }],
        },
      },
      ...overrides,
    },
  };
}

function run(currentStep = "grill"): PlaybookRunState {
  return {
    runId: "run-1",
    playbookId: "feature-development",
    playbookPath: "feature.yml",
    currentStep,
    status: "active",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    history: [],
  };
}

test("parses explicit skill invocations and visible markers", () => {
  assert.equal(parseSkillInvocation("/skill:grill-with-docs do thing"), "grill-with-docs");
  assert.equal(parseSkillInvocation("please run grill-with-docs"), undefined);
  assert.deepEqual(parseOutcomeMarker("Done\nPLAYBOOK_OUTCOME: ready-for-prd"), { kind: "outcome", outcome: "ready-for-prd" });
  assert.deepEqual(parseOutcomeMarker("PLAYBOOK_DONE"), { kind: "done" });
});

test("renders playbook prompt with valid outcomes", () => {
  const prompt = renderPlaybookPrompt(playbook(), run());
  assert.match(prompt ?? "", /Primary skill: grill-with-docs/);
  assert.match(prompt ?? "", /PLAYBOOK_OUTCOME: ready-for-prd/);
});

test("auto-advances single-outcome steps with matching invocation and marker", () => {
  const plan = planCompletion(playbook(), run(), "grill-with-docs", { kind: "outcome", outcome: "ready-for-prd" });
  assert.deepEqual(plan, {
    kind: "auto",
    outcome: "ready-for-prd",
    to: "prd",
    message: "Auto-advancing to 'prd'.",
  });
});

test("suggests instead of advancing when marker is missing", () => {
  const plan = planCompletion(playbook(), run(), "grill-with-docs", undefined);
  assert.equal(plan?.kind, "suggest");
  assert.match(plan?.message ?? "", /Run \/playbook:done/);
});

test("multi-outcome steps require explicit confirmation even with marker", () => {
  const plan = planCompletion(playbook(), run("review"), "review", { kind: "outcome", outcome: "pass" });
  assert.deepEqual(plan, {
    kind: "suggest",
    outcome: "pass",
    to: "complete",
    message: "Completion marked for step 'review'. Confirm outcome with /playbook:choose.",
  });
});

test("ignores markers without a matching skill invocation", () => {
  const plan = planCompletion(playbook(), run(), undefined, { kind: "outcome", outcome: "ready-for-prd" });
  assert.equal(plan?.kind, "warning");
  assert.match(plan?.message ?? "", /skill was not invoked/);
});

test("respects suggest and off advance modes", () => {
  const suggestPlan = planCompletion(playbook({ autoAdvance: "suggest" }), run(), "grill-with-docs", { kind: "outcome", outcome: "ready-for-prd" });
  assert.equal(suggestPlan?.kind, "suggest");
  const offPlan = planCompletion(playbook({ autoAdvance: "off" }), run(), "grill-with-docs", { kind: "outcome", outcome: "ready-for-prd" });
  assert.equal(offPlan, undefined);
});

test("extracts the last assistant text from message arrays", () => {
  const text = lastAssistantText([
    { role: "assistant", content: [{ type: "text", text: "first" }] },
    { role: "user", content: [{ type: "text", text: "ignored" }] },
    { role: "assistant", content: [{ type: "text", text: "second" }] },
  ]);
  assert.equal(text, "second");
});
