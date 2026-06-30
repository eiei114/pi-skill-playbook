import type { LoadedPlaybook, PlaybookRunState } from "./types.js";

export type ValidationLevel = "ok" | "warnings" | "blocked";

export function renderStepCard(playbook: LoadedPlaybook, run: PlaybookRunState): string[] {
  if (run.status === "completed") {
    return [
      `Playbook complete: ${playbook.definition.name}`,
      `Run: ${run.runId}`,
    ];
  }

  const step = playbook.definition.steps[run.currentStep];
  if (!step) {
    return [
      `Playbook error: ${playbook.definition.name}`,
      `Run: ${run.runId}`,
      `Missing step: ${run.currentStep}`,
    ];
  }

  const doneWhen = step.doneWhen.map((item) => `  - ${item}`);
  const outcomes = step.transitions.length > 0
    ? step.transitions.map((transition) => `${transition.outcome} -> ${transition.to}`).join(", ")
    : "complete";

  return [
    `Playbook: ${playbook.definition.name}`,
    `Run: ${run.runId}`,
    `Step: ${run.currentStep}`,
    `Next: ${step.commandHint}`,
    "Done when:",
    ...doneWhen,
    `Outcomes: ${outcomes}`,
  ];
}

export function resolveValidationLevel(errors: string[], warnings: string[]): ValidationLevel {
  if (errors.length > 0) return "blocked";
  if (warnings.length > 0) return "warnings";
  return "ok";
}

export function renderValidationSummary(level: ValidationLevel, errors: string[], warnings: string[]): string[] {
  const lines = [`Validation: ${level}`];
  for (const error of errors) lines.push(`  block: ${error}`);
  for (const warning of warnings) lines.push(`  warn: ${warning}`);
  return lines;
}

export function buildStatusLines(
  playbook: LoadedPlaybook,
  run: PlaybookRunState,
  errors: string[],
  warnings: string[],
): string[] {
  const level = resolveValidationLevel(errors, warnings);
  const summary = renderValidationSummary(level, errors, warnings);
  const stepCard = renderStepCard(playbook, run);
  return [...summary, "", ...stepCard];
}

export function renderValidationErrors(errors: string[]): string {
  return errors.map((error) => `- ${error}`).join("\n");
}
