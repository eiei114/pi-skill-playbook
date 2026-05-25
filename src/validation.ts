import { parse } from "yaml";
import type { LoadedPlaybook, PlaybookDefinition, ValidationResult } from "./types.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function parsePlaybookYaml(source: string, path: string): LoadedPlaybook {
  const parsed = parse(source) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${path}: playbook must be a YAML object`);
  }
  return { path, definition: parsed as PlaybookDefinition };
}

export function validatePlaybook(
  loaded: LoadedPlaybook,
  availableSkills: ReadonlySet<string> = new Set(),
  options: { requireSkills?: boolean } = {},
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pb = loaded.definition as PlaybookDefinition;
  const pathPrefix = loaded.path ? `${loaded.path}: ` : "";

  if (pb.version !== 1) errors.push(`${pathPrefix}version must be 1`);
  if (!isNonEmptyString(pb.id)) errors.push(`${pathPrefix}id is required`);
  else if (!ID_PATTERN.test(pb.id)) errors.push(`${pathPrefix}id must be lower-kebab-case`);
  if (!isNonEmptyString(pb.name)) errors.push(`${pathPrefix}name is required`);
  if (!isNonEmptyString(pb.entry)) errors.push(`${pathPrefix}entry is required`);
  if (!isRecord(pb.skills)) errors.push(`${pathPrefix}skills map is required`);
  if (!isRecord(pb.steps)) errors.push(`${pathPrefix}steps map is required`);

  if (!isRecord(pb.steps)) return { valid: errors.length === 0, errors, warnings };

  if (isNonEmptyString(pb.entry) && !(pb.entry in pb.steps)) {
    errors.push(`${pathPrefix}entry step '${pb.entry}' is missing`);
  }

  for (const [skillName, skill] of Object.entries(pb.skills ?? {})) {
    if (!ID_PATTERN.test(skillName)) warnings.push(`${pathPrefix}skill '${skillName}' is not lower-kebab-case`);
    if (!isRecord(skill)) {
      errors.push(`${pathPrefix}skills.${skillName} must be an object`);
      continue;
    }
    if (skill.role !== "entry" && skill.role !== "internal") {
      errors.push(`${pathPrefix}skills.${skillName}.role must be 'entry' or 'internal'`);
    }
  }

  for (const [stepId, step] of Object.entries(pb.steps)) {
    if (!ID_PATTERN.test(stepId)) errors.push(`${pathPrefix}step '${stepId}' must be lower-kebab-case`);
    if (!isRecord(step)) {
      errors.push(`${pathPrefix}steps.${stepId} must be an object`);
      continue;
    }

    if (!isNonEmptyString(step.primarySkill)) {
      errors.push(`${pathPrefix}steps.${stepId}.primarySkill is required`);
    } else {
      if (!isRecord(pb.skills) || !(step.primarySkill in pb.skills)) {
        errors.push(`${pathPrefix}steps.${stepId}.primarySkill '${step.primarySkill}' is not declared in skills`);
      }
      if (options.requireSkills && !availableSkills.has(step.primarySkill)) {
        errors.push(`${pathPrefix}steps.${stepId}.primarySkill '${step.primarySkill}' is not an available Agent Skill`);
      }
    }

    if (!isNonEmptyString(step.commandHint)) errors.push(`${pathPrefix}steps.${stepId}.commandHint is required`);
    if (!Array.isArray(step.doneWhen) || step.doneWhen.some((item) => !isNonEmptyString(item))) {
      errors.push(`${pathPrefix}steps.${stepId}.doneWhen must be a non-empty string array`);
    }
    if (!Array.isArray(step.transitions)) {
      errors.push(`${pathPrefix}steps.${stepId}.transitions must be an array`);
    } else {
      const outcomes = new Set<string>();
      for (const transition of step.transitions) {
        if (!isRecord(transition)) {
          errors.push(`${pathPrefix}steps.${stepId}.transitions contains a non-object transition`);
          continue;
        }
        if (!isNonEmptyString(transition.outcome)) {
          errors.push(`${pathPrefix}steps.${stepId}.transition.outcome is required`);
        } else if (outcomes.has(transition.outcome)) {
          errors.push(`${pathPrefix}steps.${stepId}.transition outcome '${transition.outcome}' is duplicated`);
        } else {
          outcomes.add(transition.outcome);
        }
        if (!isNonEmptyString(transition.to)) {
          errors.push(`${pathPrefix}steps.${stepId}.transition.to is required`);
        } else if (transition.to !== "complete" && !(transition.to in pb.steps)) {
          errors.push(`${pathPrefix}steps.${stepId}.transition '${transition.outcome}' targets missing step '${transition.to}'`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateUniquePlaybookIds(playbooks: LoadedPlaybook[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>();
  for (const playbook of playbooks) {
    const id = playbook.definition.id;
    if (!isNonEmptyString(id)) continue;
    const previous = seen.get(id);
    if (previous) errors.push(`duplicate playbook id '${id}' in ${previous} and ${playbook.path}`);
    else seen.set(id, playbook.path);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function normalizeSkillCommandName(name: string): string {
  return name.replace(/^\//, "").replace(/^skill:/, "");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
