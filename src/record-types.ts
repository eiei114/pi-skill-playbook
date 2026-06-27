import type { PlaybookTransition } from "./types.js";

export type RecordMarkKind = "skill" | "branch";

export interface RecordMark {
  at: string;
  kind: RecordMarkKind;
  skillName?: string;
  outcome?: string;
  toStepId?: string;
}

export interface RecordedStepDraft {
  id: string;
  primarySkill: string;
  commandHint: string;
  doneWhen: string[];
  transitions: PlaybookTransition[];
  closed: boolean;
}

export interface RecordSession {
  sessionId: string;
  playbookId: string;
  playbookName: string;
  status: "recording";
  createdAt: string;
  updatedAt: string;
  entryStepId: string | null;
  currentStepId: string | null;
  steps: Record<string, RecordedStepDraft>;
  pendingBranch: { fromStepId: string; outcome: string } | null;
  marks: RecordMark[];
}
