import { listCompletedRuns, summarizeCompletedRun, finalOutcome } from "./history.js";
import { loadRun } from "./state.js";
import type { PlaybookRunHistoryEntry, PlaybookRunState } from "./types.js";

/** One side of a run-diff comparison: metadata and history for a completed run. */
export interface RunDiffEntry {
  /** Run identifier. */
  runId: string;
  /** Human-readable playbook name. */
  playbookName: string;
  /** ISO timestamp of when the run completed. */
  completedAt: string;
  /** Final outcome label (e.g. "complete", "cancelled"). */
  finalOutcome: string;
  /** Number of history entries (completed steps). */
  stepCount: number;
  /** Full step-by-step history of the run. */
  history: PlaybookRunHistoryEntry[];
}

/** Result of comparing two completed playbook runs. */
export interface RunDiffResult {
  /** The more recent run. */
  newer: RunDiffEntry;
  /** The older run. */
  older: RunDiffEntry;
  /** Human-readable change descriptions. */
  changes: string[];
}

/**
 * Produce a safe RunDiffEntry from a run state and playbook name.
 * Returns undefined when the run has no meaningful data to compare.
 */
export function toRunDiffEntry(run: PlaybookRunState, playbookName: string): RunDiffEntry | undefined {
  if (run.status !== "completed") return undefined;
  return {
    runId: run.runId,
    playbookName,
    completedAt: run.updatedAt,
    finalOutcome: finalOutcome(run),
    stepCount: run.history.length,
    history: run.history,
  };
}

/**
 * Compare two completed run entries and produce a human-readable list of
 * meaningful changes.
 *
 * The diff highlights:
 *  - Which run is newer/older
 *  - Different playbooks
 *  - Different final outcomes
 *  - Different step counts
 *  - Per-step differences (step name, outcome, destination)
 *  - Extra or missing steps
 */
export function computeRunDiff(newer: RunDiffEntry, older: RunDiffEntry): RunDiffResult {
  const changes: string[] = [];

  // Playbook name difference
  if (newer.playbookName !== older.playbookName) {
    changes.push(`Playbook changed: "${newer.playbookName}" vs "${older.playbookName}"`);
  }

  // Final outcome difference
  if (newer.finalOutcome !== older.finalOutcome) {
    changes.push(`Final outcome changed: "${newer.finalOutcome}" (was "${older.finalOutcome}")`);
  }

  // Step count difference
  if (newer.stepCount !== older.stepCount) {
    changes.push(`Step count changed: ${newer.stepCount} steps (was ${older.stepCount})`);
  }

  // Per-step diff (compare aligned history entries)
  const maxLen = Math.max(newer.history.length, older.history.length);
  for (let i = 0; i < maxLen; i++) {
    const n = newer.history[i];
    const o = older.history[i];
    const stepLabel = `Step ${i + 1}`;

    if (!o && n) {
      // New step appeared
      changes.push(`${stepLabel} added: "${n.step}" → ${n.outcome} (${n.to})`);
    } else if (!n && o) {
      // Step removed
      changes.push(`${stepLabel} removed: was "${o.step}" → ${o.outcome} (${o.to})`);
    } else if (n && o) {
      const diffs: string[] = [];
      if (n.step !== o.step) diffs.push(`step "${n.step}" was "${o.step}"`);
      if (n.outcome !== o.outcome) diffs.push(`outcome "${n.outcome}" was "${o.outcome}"`);
      if (n.to !== o.to) diffs.push(`destination "${n.to}" was "${o.to}"`);

      if (diffs.length > 0) {
        changes.push(`${stepLabel} differs: ${diffs.join("; ")}`);
      }
    }
  }

  // If nothing changed at all
  if (changes.length === 0) {
    changes.push("All steps match — output is identical.");
  }

  return { newer, older, changes };
}

/**
 * Format a run-diff result into display lines.
 *
 * Example output:
 *
 * Run diff: feature-dev-20260602 vs feature-dev-20260601
 *   Newer: Feature Development Playbook (2026-06-02T12:00:00Z) — complete
 *   Older: Feature Development Playbook (2026-06-01T12:00:00Z) — complete
 * Changes:
 *   Step 2 differs: step "prd" was "issues"
 *   Step 3 removed: was "review" → pass (complete)
 */
export function formatRunDiff(result: RunDiffResult): string[] {
  const lines: string[] = [
    `Run diff: ${result.newer.runId} vs ${result.older.runId}`,
    `  Newer: ${result.newer.playbookName} (${result.newer.completedAt}) — ${result.newer.finalOutcome}`,
    `  Older: ${result.older.playbookName} (${result.older.completedAt}) — ${result.older.finalOutcome}`,
  ];

  if (result.changes.length > 0) {
    lines.push("Changes:");
    for (const change of result.changes) {
      lines.push(`  ${change}`);
    }
  }

  return lines;
}

/**
 * Load the N most recent completed runs and pair them into (newer, older)
 * diff results for adjacent comparisons.
 *
 * Returns at most count - 1 results. Each result compares entry[i] (newer)
 * against entry[i + 1] (older).
 */
export async function loadRecentRunDiffs(cwd: string, count?: number): Promise<RunDiffResult[]> {
  const runs = await listCompletedRuns(cwd);
  const maxRuns = count ?? runs.length;
  const limit = Math.min(maxRuns, runs.length);
  const entries = await Promise.all(
    runs.slice(0, limit).map((run) => toRunDiffEntryFromRun(cwd, run)),
  );
  const results: RunDiffResult[] = [];

  for (let i = 0; i < entries.length - 1; i++) {
    const newerEntry = entries[i];
    const olderEntry = entries[i + 1];
    if (newerEntry && olderEntry) {
      results.push(computeRunDiff(newerEntry, olderEntry));
    }
  }

  return results;
}

/**
 * Load a completed run from disk and convert it into a RunDiffEntry.
 * Returns undefined if the run is not completed or data is missing.
 */
async function toRunDiffEntryFromRun(cwd: string, run: PlaybookRunState): Promise<RunDiffEntry | undefined> {
  const summary = await summarizeCompletedRun(cwd, run);
  return toRunDiffEntry(run, summary.playbookName);
}
