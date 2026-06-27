import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { PLAYBOOK_DIR } from "./playbooks.js";
import { renderValidationErrors } from "./render.js";
import type { LoadedPlaybook, PlaybookDefinition } from "./types.js";
import { parsePlaybookYaml, validatePlaybook } from "./validation.js";

export interface DraftSaveUi {
  notify(message: string, level: "info" | "warning" | "error"): void;
  confirm?(title: string, message: string): Promise<boolean>;
}

export function definitionToYaml(definition: PlaybookDefinition): string {
  return `${stringify(definition)}\n`;
}

export function previewDraft(definition: PlaybookDefinition, targetPath: string): string {
  const yaml = definitionToYaml(definition);
  return [`Target: ${targetPath}`, "", yaml.trimEnd()].join("\n");
}

export function validateDraftDefinition(
  definition: PlaybookDefinition,
  targetPath: string,
  availableSkills: ReadonlySet<string>,
): { loaded: LoadedPlaybook; result: ReturnType<typeof validatePlaybook> } {
  const loaded = parsePlaybookYaml(definitionToYaml(definition), targetPath);
  const result = validatePlaybook(loaded, availableSkills, { requireSkills: true });
  return { loaded, result };
}

export async function savePlaybookDraft(
  cwd: string,
  definition: PlaybookDefinition,
  availableSkills: ReadonlySet<string>,
  ui: DraftSaveUi | undefined,
  options: { sourceLabel: string },
): Promise<boolean> {
  const targetPath = join(cwd, PLAYBOOK_DIR, `${definition.id}.yml`);
  const preview = previewDraft(definition, targetPath);
  const { result } = validateDraftDefinition(definition, targetPath, availableSkills);

  notify(ui, preview, "info");

  if (!result.valid) {
    notify(ui, `${options.sourceLabel} draft validation failed:\n${renderValidationErrors(result.errors)}`, "error");
    return false;
  }

  if (ui?.confirm) {
    const confirmed = await ui.confirm(
      `Save ${options.sourceLabel} playbook draft?`,
      `Write ${definition.id}.yml to ${PLAYBOOK_DIR}/ after validation.`,
    );
    if (!confirmed) {
      notify(ui, `${options.sourceLabel} draft save skipped.`, "info");
      return false;
    }
  }

  await mkdir(join(cwd, PLAYBOOK_DIR), { recursive: true });
  await writeFile(targetPath, definitionToYaml(definition), "utf8");
  notify(ui, `Saved playbook draft to ${targetPath}.`, "info");
  return true;
}

function notify(ui: DraftSaveUi | undefined, message: string, level: "info" | "warning" | "error"): void {
  ui?.notify(message, level);
}
