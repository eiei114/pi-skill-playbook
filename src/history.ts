import { findPlaybook } from "./playbooks.js";
import { listRunIds, loadRun } from "./state.js";
import type { PlaybookRunState } from "./types.js";

export interface CompletedRunSummary {
  run: PlaybookRunState;
  playbookName: string;
  completedAt: string;
  finalOutcome: string;
}

export function finalOutcome(run: PlaybookRunState): string {
  const last = run.history.at(-1);
  return last?.outcome ?? "complete";
}

export async function listCompletedRuns(cwd: string): Promise<PlaybookRunState[]> {
  const ids = await listRunIds(cwd);
  const runs = (await Promise.all(ids.map((id) => loadRun(cwd, id)))).filter((run): run is PlaybookRunState => Boolean(run));
  return runs.filter((run) => run.status === "completed").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function summarizeCompletedRun(cwd: string, run: PlaybookRunState): Promise<CompletedRunSummary> {
  const playbook = await findPlaybook(cwd, run.playbookId);
  return {
    run,
    playbookName: playbook?.definition.name ?? run.playbookId,
    completedAt: run.updatedAt,
    finalOutcome: finalOutcome(run),
  };
}

export async function listCompletedRunSummaries(cwd: string): Promise<CompletedRunSummary[]> {
  const runs = await listCompletedRuns(cwd);
  return Promise.all(runs.map((run) => summarizeCompletedRun(cwd, run)));
}

export function formatCompletedRunLine(summary: CompletedRunSummary): string {
  return `${summary.run.runId} — ${summary.playbookName} — ${summary.completedAt} — ${summary.finalOutcome}`;
}

export function renderCompletedRunDetail(summary: CompletedRunSummary): string[] {
  const history = summary.run.history.map((entry) => `  ${entry.at} ${entry.step} → ${entry.outcome} (${entry.to})`);
  return [
    `Completed: ${summary.playbookName}`,
    `Run: ${summary.run.runId}`,
    `Finished: ${summary.completedAt}`,
    `Final outcome: ${summary.finalOutcome}`,
    ...(history.length > 0 ? ["History:", ...history] : []),
  ];
}
