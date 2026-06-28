import { loadPlaybooks } from "./playbooks.js";
import { buildStatusLines, resolveValidationLevel, type ValidationLevel } from "./render.js";
import { validatePlaybook, validateRunState, validateUniquePlaybookIds } from "./validation.js";
import type { LoadedPlaybook, PlaybookRunState, ValidationResult } from "./types.js";

export interface RunStatusPresentation {
  lines: string[];
  level: ValidationLevel;
  validation: ValidationResult;
  runErrors: string[];
}

export async function buildRunStatusPresentation(
  cwd: string,
  playbook: LoadedPlaybook,
  run: PlaybookRunState,
  availableSkills: ReadonlySet<string>,
): Promise<RunStatusPresentation> {
  const playbookValidation = validatePlaybook(playbook, availableSkills, { requireSkills: true });
  const runErrors = validateRunState(playbook, run);
  const playbooks = await loadPlaybooks(cwd);
  const duplicateErrors = validateUniquePlaybookIds(playbooks).errors.filter(
    (error) => error.includes(`'${playbook.definition.id}'`),
  );
  const errors = [...runErrors, ...playbookValidation.errors, ...duplicateErrors];
  const validation: ValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings: playbookValidation.warnings,
  };
  const level = resolveValidationLevel(errors, playbookValidation.warnings);
  const lines = buildStatusLines(playbook, run, errors, playbookValidation.warnings);
  return { lines, level, validation, runErrors };
}

export function notifyLevelForValidation(level: ValidationLevel, hasAdvisory: boolean): "info" | "warning" | "error" {
  if (level === "blocked") return "error";
  if (level === "warnings" || hasAdvisory) return "warning";
  return "info";
}
