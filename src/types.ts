export type SkillRole = "entry" | "internal";
export type AdvanceMode = "auto" | "suggest" | "off";

export interface PlaybookSkillDefinition {
  role: SkillRole;
}

export interface PlaybookTransition {
  outcome: string;
  to: string;
}

export interface PlaybookStep {
  primarySkill: string;
  commandHint: string;
  doneWhen: string[];
  transitions: PlaybookTransition[];
}

export interface PlaybookDefinition {
  version: 1;
  id: string;
  name: string;
  entry: string;
  autoAdvance?: AdvanceMode;
  skills: Record<string, PlaybookSkillDefinition>;
  steps: Record<string, PlaybookStep>;
  sources?: Array<{ url: string; title?: string; accessedAt: string }>;
}

export interface LoadedPlaybook {
  path: string;
  definition: PlaybookDefinition;
}

export interface PlaybookRunHistoryEntry {
  at: string;
  step: string;
  outcome: string;
  to: string;
}

export interface PlaybookRunState {
  runId: string;
  playbookId: string;
  playbookPath: string;
  currentStep: string;
  status: "active" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  history: PlaybookRunHistoryEntry[];
}

export interface ActiveRunState {
  runId: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
