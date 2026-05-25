import type { LoadedPlaybook, PlaybookRunState } from "./types.js";

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

export function renderValidationErrors(errors: string[]): string {
  return errors.map((error) => `- ${error}`).join("\n");
}
