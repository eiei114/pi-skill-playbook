import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseOutcomeMarker,
  parseSkillInvocation,
  planCompletion,
  renderPlaybookPrompt,
  type CompletionPlan,
} from "../../src/auto-advance.js";
import type { AdvanceMode, LoadedPlaybook, PlaybookRunState } from "../../src/types.js";

const FIXTURE_ROOT = join(import.meta.dirname, "..", "fixtures", "auto-advance");

export interface FixturePlanExpect {
  kind: CompletionPlan["kind"];
  outcome?: string;
  to?: string;
  messageIncludes?: string;
}

export interface FixturePromptExpect {
  absent?: boolean;
  includes?: string[];
}

export interface AutoAdvanceScenario {
  id: string;
  description: string;
  autoAdvance?: AdvanceMode;
  currentStep: string;
  turn: {
    userInput: string;
    assistantText: string;
  };
  expect: {
    plan: FixturePlanExpect | null;
    mutatesState: boolean;
    prompt?: FixturePromptExpect;
  };
}

export function loadFixturePlaybook(): LoadedPlaybook {
  const raw = readFileSync(join(FIXTURE_ROOT, "playbook.json"), "utf8");
  return JSON.parse(raw) as LoadedPlaybook;
}

export function loadAutoAdvanceScenarios(): AutoAdvanceScenario[] {
  const scenariosDir = join(FIXTURE_ROOT, "scenarios");
  return readdirSync(scenariosDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const scenario = JSON.parse(readFileSync(join(scenariosDir, name), "utf8")) as AutoAdvanceScenario;
      if (scenario.id !== name.replace(/\.json$/, "")) {
        throw new Error(`Scenario id '${scenario.id}' must match filename '${name}'`);
      }
      return scenario;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function playbookForScenario(base: LoadedPlaybook, scenario: AutoAdvanceScenario): LoadedPlaybook {
  if (!scenario.autoAdvance) return base;
  return {
    ...base,
    definition: {
      ...base.definition,
      autoAdvance: scenario.autoAdvance,
    },
  };
}

export function runForScenario(base: LoadedPlaybook, scenario: AutoAdvanceScenario): PlaybookRunState {
  const now = "2026-06-27T12:00:00.000Z";
  return {
    runId: `fixture-${scenario.id}`,
    playbookId: base.definition.id,
    playbookPath: base.path,
    currentStep: scenario.currentStep,
    status: "active",
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}

export function evaluateScenario(base: LoadedPlaybook, scenario: AutoAdvanceScenario): {
  playbook: LoadedPlaybook;
  run: PlaybookRunState;
  invokedSkill: string | undefined;
  marker: ReturnType<typeof parseOutcomeMarker>;
  plan: CompletionPlan | undefined;
  prompt: string | undefined;
} {
  const playbook = playbookForScenario(base, scenario);
  const run = runForScenario(base, scenario);
  const invokedSkill = parseSkillInvocation(scenario.turn.userInput);
  const marker = parseOutcomeMarker(scenario.turn.assistantText);
  const plan = planCompletion(playbook, run, invokedSkill, marker);
  const prompt = renderPlaybookPrompt(playbook, run);
  return { playbook, run, invokedSkill, marker, plan, prompt };
}

export function planMutatesState(plan: CompletionPlan | undefined): boolean {
  return plan?.kind === "auto";
}

export function assertPlanMatches(actual: CompletionPlan | undefined, expected: FixturePlanExpect | null, label: string): void {
  if (expected === null) {
    if (actual !== undefined) {
      throw new Error(`${label}: expected no plan, got ${JSON.stringify(actual)}`);
    }
    return;
  }

  if (!actual) {
    throw new Error(`${label}: expected plan ${JSON.stringify(expected)}, got undefined`);
  }

  if (actual.kind !== expected.kind) {
    throw new Error(`${label}: expected kind '${expected.kind}', got '${actual.kind}'`);
  }

  if (expected.outcome !== undefined && actual.outcome !== expected.outcome) {
    throw new Error(`${label}: expected outcome '${expected.outcome}', got '${actual.outcome}'`);
  }

  if (expected.to !== undefined && actual.to !== expected.to) {
    throw new Error(`${label}: expected to '${expected.to}', got '${actual.to}'`);
  }

  if (expected.messageIncludes && !actual.message.includes(expected.messageIncludes)) {
    throw new Error(`${label}: message must include '${expected.messageIncludes}', got '${actual.message}'`);
  }
}

export function assertPromptMatches(actual: string | undefined, expected: FixturePromptExpect | undefined, label: string): void {
  if (!expected) return;

  if (expected.absent) {
    if (actual !== undefined) {
      throw new Error(`${label}: expected no prompt, got '${actual}'`);
    }
    return;
  }

  if (!actual) {
    throw new Error(`${label}: expected prompt, got undefined`);
  }

  for (const fragment of expected.includes ?? []) {
    if (!actual.includes(fragment)) {
      throw new Error(`${label}: prompt must include '${fragment}'`);
    }
  }
}
