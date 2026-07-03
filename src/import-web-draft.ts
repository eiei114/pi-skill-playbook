import { parse } from "yaml";
import type { FetchedUrlContent } from "./url-content.js";
import type { PlaybookDefinition } from "./types.js";
import { normalizeSkillCommandName, validatePlaybook } from "./validation.js";

export interface ModelDraftRequest {
  query?: string;
  sources: FetchedUrlContent[];
  availableSkills: string[];
  targetId?: string;
}

export interface ModelDrafter {
  draft(request: ModelDraftRequest): Promise<string>;
}

export function buildDraftPrompt(request: ModelDraftRequest): string {
  const skills = request.availableSkills.length > 0
    ? request.availableSkills.join(", ")
    : "(none discovered)";
  const sourceBlocks = request.sources.map((source, index) => {
    const heading = source.title ? `${source.title} (${source.url})` : source.url;
    return [`Source ${index + 1}: ${heading}`, source.text].join("\n");
  });

  return [
    "You are drafting a Pi Skill Playbook YAML definition from external workflow articles.",
    "Return ONLY one fenced ```yaml block containing a valid playbook object.",
    "Use version: 1, lower-kebab-case ids, one primarySkill per step, and explicit transitions.",
    "Prefer discovered Agent Skill names when they fit. Do not invent skills that are not listed.",
    request.targetId ? `Use playbook id '${request.targetId}' unless the content strongly suggests another id.` : "Choose a concise lower-kebab-case playbook id.",
    request.query ? `User query: ${request.query}` : undefined,
    `Discovered Agent Skills: ${skills}`,
    "",
    ...sourceBlocks,
    "",
    "Required YAML shape:",
    "version: 1",
    "id: example-id",
    "name: Example Name",
    "entry: first-step",
    "skills:",
    "  skill-name:",
    "    role: entry",
    "steps:",
    "  first-step:",
    "    primarySkill: skill-name",
    "    commandHint: \"/skill:skill-name\"",
    "    doneWhen:",
    "      - criterion",
    "    transitions:",
    "      - outcome: complete",
    "        to: complete",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function extractYamlBlock(raw: string): string {
  const fenced = raw.match(/```(?:ya?ml)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const trimmed = raw.trim();
  if (trimmed.startsWith("version:")) return trimmed;
  throw new Error("Model response did not include a YAML playbook draft.");
}

export function parseImportedPlaybookDraft(raw: string, targetId?: string): PlaybookDefinition {
  const yaml = extractYamlBlock(raw);
  const parsed = parse(yaml) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Imported playbook draft must be a YAML object.");
  }

  const definition = parsed as PlaybookDefinition;
  if (targetId) definition.id = targetId;

  const validation = validatePlaybook(
    { path: "imported-draft", definition },
    new Set(),
    { requireSkills: false },
  );
  if (!validation.valid) {
    throw new Error(`Imported playbook draft is invalid:\n${validation.errors.join("\n")}`);
  }

  return definition;
}

export function buildRequiredSourceTrace(
  sources: FetchedUrlContent[],
): NonNullable<PlaybookDefinition["sources"]> {
  return sources.map((source) => ({
    url: source.url,
    title: source.title,
    accessedAt: source.fetchedAt,
  }));
}

export function attachRequiredSourceTrace(
  definition: PlaybookDefinition,
  sources: FetchedUrlContent[],
): PlaybookDefinition {
  return {
    ...definition,
    sources: buildRequiredSourceTrace(sources),
  };
}

export function mapSkillsBestEffort(
  definition: PlaybookDefinition,
  availableSkills: ReadonlySet<string>,
): { definition: PlaybookDefinition; missingSkills: string[] } {
  const mapping = new Map<string, string>();
  const missing = new Set<string>();

  for (const step of Object.values(definition.steps ?? {})) {
    const original = normalizeSkillCommandName(step.primarySkill);
    const mapped = resolveSkillName(original, availableSkills);
    if (!mapped) {
      missing.add(original);
      continue;
    }
    mapping.set(original, mapped);
  }

  const skills = { ...(definition.skills ?? {}) };
  const steps = Object.fromEntries(
    Object.entries(definition.steps ?? {}).map(([stepId, step]) => {
      const mappedSkill = mapping.get(normalizeSkillCommandName(step.primarySkill)) ?? step.primarySkill;
      return [stepId, { ...step, primarySkill: mappedSkill }];
    }),
  );

  for (const mapped of mapping.values()) {
    if (!skills[mapped]) {
      skills[mapped] = { role: mapped === definition.entry ? "entry" : "internal" };
    }
  }

  return {
    definition: {
      ...definition,
      skills,
      steps,
    },
    missingSkills: [...missing],
  };
}

function resolveSkillName(skillName: string, availableSkills: ReadonlySet<string>): string | undefined {
  if (availableSkills.has(skillName)) return skillName;

  const normalizedTargets = [...availableSkills];
  const exactIgnoreCase = normalizedTargets.find((candidate) => candidate.toLowerCase() === skillName.toLowerCase());
  if (exactIgnoreCase) return exactIgnoreCase;

  const slug = skillName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalizedTargets.find((candidate) => candidate === slug);
}

export function formatMissingSkillErrors(missingSkills: string[], availableSkills: ReadonlySet<string>): string {
  const suggestions = [...availableSkills].sort().slice(0, 8);
  const lines = [
  ...missingSkills.map((skill) => `- '${skill}' is not an available Agent Skill`),
  ];
  if (suggestions.length > 0) {
    lines.push("", "Available skills:", ...suggestions.map((skill) => `- ${skill}`));
  }
  return lines.join("\n");
}
