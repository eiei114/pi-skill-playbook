import type { AdvanceMode, LoadedPlaybook, PlaybookRunState, PlaybookStep } from "./types.js";

export type OutcomeMarker =
  | { kind: "outcome"; outcome: string }
  | { kind: "done" };

export interface CompletionPlan {
  kind: "auto" | "suggest" | "ignore" | "warning";
  outcome?: string;
  to?: string;
  message: string;
}

export function getAdvanceMode(playbook: LoadedPlaybook): AdvanceMode {
  return playbook.definition.autoAdvance ?? "auto";
}

export function parseSkillInvocation(input: string): string | undefined {
  const match = input.match(/^\s*\/skill:([a-z0-9][a-z0-9-]*)\b/i);
  return match?.[1]?.toLowerCase();
}

export function parseOutcomeMarker(text: string): OutcomeMarker | undefined {
  const outcomeMatch = text.match(/^\s*PLAYBOOK_OUTCOME:\s*([a-z0-9][a-z0-9-]*)\s*$/im);
  if (outcomeMatch?.[1]) return { kind: "outcome", outcome: outcomeMatch[1].toLowerCase() };
  if (/^\s*PLAYBOOK_DONE\s*$/im.test(text)) return { kind: "done" };
  return undefined;
}

export function renderPlaybookPrompt(playbook: LoadedPlaybook, run: PlaybookRunState): string | undefined {
  if (getAdvanceMode(playbook) === "off") return undefined;
  const step = playbook.definition.steps[run.currentStep];
  if (!step) return undefined;

  const outcomes = step.transitions.map((transition) => transition.outcome);
  const markerInstruction = outcomes.length === 0
    ? "If you complete this final step, end your response with exactly: PLAYBOOK_DONE"
    : outcomes.length === 1
      ? `If you complete this step, end your response with exactly: PLAYBOOK_OUTCOME: ${outcomes[0]}`
      : `If you complete this step, end your response with one recommended outcome marker such as: PLAYBOOK_OUTCOME: ${outcomes[0]}`;
  const multiOutcomeNote = outcomes.length > 1
    ? "This step has multiple outcomes; the marker will be shown to the user for explicit confirmation, not auto-applied."
    : "Single-outcome completion markers may advance the active playbook automatically.";

  return [
    "Active Pi Skill Playbook run:",
    `- Playbook: ${playbook.definition.name}`,
    `- Run: ${run.runId}`,
    `- Step: ${run.currentStep}`,
    `- Primary skill: ${step.primarySkill}`,
    `- Valid outcomes: ${outcomes.length > 0 ? outcomes.join(", ") : "complete"}`,
    markerInstruction,
    multiOutcomeNote,
    "Do not emit a marker unless the active step is genuinely complete.",
  ].join("\n");
}

export function planCompletion(
  playbook: LoadedPlaybook,
  run: PlaybookRunState,
  invokedSkill: string | undefined,
  marker: OutcomeMarker | undefined,
): CompletionPlan | undefined {
  const mode = getAdvanceMode(playbook);
  if (mode === "off") return undefined;

  const step = playbook.definition.steps[run.currentStep];
  if (!step) return { kind: "warning", message: `Current step '${run.currentStep}' is missing.` };

  const matchingInvocation = invokedSkill === step.primarySkill;
  if (!matchingInvocation) {
    if (marker) {
      return {
        kind: "warning",
        message: "Ignored PLAYBOOK_OUTCOME because current step skill was not invoked.",
      };
    }
    return undefined;
  }

  if (!marker) return suggestPlan(step, run.currentStep);

  const resolved = resolveMarker(step, marker);
  if (!resolved) {
    const valid = validOutcomeText(step);
    return { kind: "warning", message: `Ignored invalid playbook marker for step '${run.currentStep}'. Valid: ${valid}` };
  }

  if (step.transitions.length > 1) {
    return {
      kind: "suggest",
      outcome: resolved.outcome,
      to: resolved.to,
      message: `Completion marked for step '${run.currentStep}'. Confirm outcome with /playbook:choose.`,
    };
  }

  if (mode === "suggest") {
    return {
      kind: "suggest",
      outcome: resolved.outcome,
      to: resolved.to,
      message: resolved.outcome === "complete"
        ? `Completion marked for final step '${run.currentStep}'. Run /playbook:done to complete.`
        : `Completion marked for step '${run.currentStep}'. Run /playbook:done to advance to '${resolved.to}'.`,
    };
  }

  return {
    kind: "auto",
    outcome: resolved.outcome,
    to: resolved.to,
    message: resolved.to === "complete" ? `Auto-completing playbook run from step '${run.currentStep}'.` : `Auto-advancing to '${resolved.to}'.`,
  };
}

export function textFromMessage(message: unknown): string {
  if (!isRecord(message)) return "";
  return textFromContent(message.content);
}

export function lastAssistantText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (isRecord(message) && message.role === "assistant") return textFromMessage(message);
  }
  return "";
}

function suggestPlan(step: PlaybookStep, stepId: string): CompletionPlan {
  if (step.transitions.length === 0) {
    return { kind: "suggest", outcome: "complete", to: "complete", message: `Completion suspected for final step '${stepId}'. Run /playbook:done to complete.` };
  }
  if (step.transitions.length === 1) {
    const transition = step.transitions[0]!;
    return {
      kind: "suggest",
      outcome: transition.outcome,
      to: transition.to,
      message: `Completion suspected for step '${stepId}'. Run /playbook:done to advance to '${transition.to}'.`,
    };
  }
  return {
    kind: "suggest",
    message: `Completion suspected for step '${stepId}'. Run /playbook:choose to select an outcome.`,
  };
}

function resolveMarker(step: PlaybookStep, marker: OutcomeMarker): { outcome: string; to: string } | undefined {
  if (marker.kind === "done") {
    if (step.transitions.length === 0) return { outcome: "complete", to: "complete" };
    if (step.transitions.length === 1) {
      const transition = step.transitions[0]!;
      return { outcome: transition.outcome, to: transition.to };
    }
    return undefined;
  }

  const transition = step.transitions.find((candidate) => candidate.outcome === marker.outcome);
  if (!transition) return undefined;
  return { outcome: transition.outcome, to: transition.to };
}

function validOutcomeText(step: PlaybookStep): string {
  if (step.transitions.length === 0) return "PLAYBOOK_DONE";
  return step.transitions.map((transition) => transition.outcome).join(", ");
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (typeof item === "string") return item;
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") return item.text;
    return "";
  }).filter(Boolean).join("\n");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
