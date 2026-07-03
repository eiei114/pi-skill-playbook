import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { savePlaybookDraft } from "./draft-save.js";
import {
  attachRequiredSourceTrace,
  buildDraftPrompt,
  formatMissingSkillErrors,
  mapSkillsBestEffort,
  parseImportedPlaybookDraft,
  type ModelDraftRequest,
  type ModelDrafter,
} from "./import-web-draft.js";
import { createSearchProviderFromEnv, type FetchLike, type SearchProviderAdapter, type SearchResult } from "./search-provider.js";
import { fetchUrlContents, type FetchedUrlContent } from "./url-content.js";
import { normalizeSkillCommandName } from "./validation.js";

type ImportWebUi = {
  notify(message: string, level: "info" | "warning" | "error"): void;
  select?(title: string, options: string[]): Promise<string | undefined>;
  confirm?(title: string, message: string): Promise<boolean>;
  input?(title: string, placeholder?: string): Promise<string | undefined>;
};

export type ImportWebContext = {
  cwd: string;
  hasUI: boolean;
  ui?: ImportWebUi;
};

export interface ImportWebDeps {
  searchProvider?: SearchProviderAdapter;
  fetchFn?: FetchLike;
  modelDrafter?: ModelDrafter;
  now?: () => string;
}

export function importWebUsage(): string {
  return [
    "Usage:",
    "/playbook:import-web [<query>] [--url <url> ...] [--id <playbook-id>]",
    "",
    "Happy path: run without args in the Pi TUI to enter a query, pick search results, confirm model drafting, then save.",
  ].join("\n");
}

export async function handleImportWebCommand(
  pi: ExtensionAPI,
  args: string,
  ctx: ImportWebContext,
  deps: ImportWebDeps = {},
): Promise<void> {
  const ui = ctx.hasUI ? ctx.ui : undefined;
  const parsed = parseImportWebArgs(args);
  const availableSkills = getAvailableSkills(pi);

  let query = parsed.query;
  if (!query && !parsed.urls.length && ui?.input) {
    query = (await ui.input("Web import search query", "Describe the workflow to import"))?.trim();
  }
  if (!query && parsed.urls.length === 0) {
    notify(ui, "A search query or at least one --url is required.\n" + importWebUsage(), "error");
    return;
  }

  const searchProvider = deps.searchProvider ?? createSearchProviderFromEnv();
  let selectedResults: SearchResult[] = [];
  if (query) {
    if (!searchProvider) {
      notify(
        ui,
        [
          "Brave Search is not configured.",
          "Set BRAVE_SEARCH_API_KEY (or BRAVE_API_KEY) to search the web.",
          "You can still pass explicit URLs with --url.",
        ].join("\n"),
        "error",
      );
      if (parsed.urls.length === 0) return;
    } else {
      const results = await searchProvider.search(query, { count: 5 });
      if (results.length === 0) {
        notify(ui, `No web results found for '${query}'.`, "warning");
      } else {
        selectedResults = await pickSearchResults(results, ui);
      }
    }
  }

  const urls = [...new Set([
    ...parsed.urls,
    ...selectedResults.map((result) => result.url),
  ])];

  if (urls.length === 0) {
    notify(ui, "No URLs selected for import.\n" + importWebUsage(), "error");
    return;
  }

  const fetched = await fetchUrlContents(urls, deps.fetchFn, deps.now);
  const modelDrafter = deps.modelDrafter;
  if (!modelDrafter) {
    notify(ui, "Model drafting is unavailable. Configure a Pi model provider before running import-web.", "error");
    return;
  }

  const draftRequest: ModelDraftRequest = {
    query,
    sources: fetched,
    availableSkills: [...availableSkills].sort(),
    targetId: parsed.id,
  };
  const draftPrompt = buildDraftPrompt(draftRequest);

  if (!ui?.confirm) {
    notify(ui, "Confirmation UI is required before model-assisted drafting.", "error");
    return;
  }

  const modelConfirmed = await ui.confirm(
    "Send model-assisted draft request?",
  [
    "The following prompt will be sent to the active Pi model:",
    "",
    truncateForUi(draftPrompt, 1800),
  ].join("\n"),
  );
  if (!modelConfirmed) {
    notify(ui, "Import-web model drafting skipped.", "info");
    return;
  }

  const rawDraft = await modelDrafter.draft(draftRequest);
  let definition = attachRequiredSourceTrace(
    parseImportedPlaybookDraft(rawDraft, parsed.id),
    fetched,
  );
  const mapped = mapSkillsBestEffort(definition, availableSkills);
  definition = mapped.definition;

  if (mapped.missingSkills.length > 0) {
    notify(
      ui,
      `Imported draft has missing skill mappings:\n${formatMissingSkillErrors(mapped.missingSkills, availableSkills)}`,
      "error",
    );
    return;
  }

  const saved = await savePlaybookDraft(ctx.cwd, definition, availableSkills, ui, { sourceLabel: "Imported web" });
  if (saved) {
    notify(ui, `Imported playbook draft '${definition.id}' from ${urls.length} source URL(s).`, "info");
  }
}

export function parseImportWebArgs(args: string): { query?: string; urls: string[]; id?: string } {
  const tokens = tokenize(args);
  const urls: string[] = [];
  let id: string | undefined;
  const queryParts: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--url") {
      const url = tokens[++index];
      if (url) urls.push(url);
      continue;
    }
    if (token === "--id") {
      id = tokens[++index];
      continue;
    }
    queryParts.push(token);
  }

  const query = queryParts.join(" ").trim();
  return {
    query: query || undefined,
    urls,
    id,
  };
}

async function pickSearchResults(results: SearchResult[], ui: ImportWebUi | undefined): Promise<SearchResult[]> {
  if (!ui?.select) {
    return results.slice(0, 3);
  }

  if (results.length === 1) {
    return results;
  }

  const options = [
    ...results.map((result) => formatSearchResultLabel(result)),
    "Use top 3 results",
  ];
  const selected = await ui.select("Import from which search result?", options);
  if (!selected) return [];

  if (selected === "Use top 3 results") {
    return results.slice(0, 3);
  }

  const match = results.find((result) => formatSearchResultLabel(result) === selected);
  return match ? [match] : [];
}

function formatSearchResultLabel(result: SearchResult): string {
  const snippet = result.snippet ? ` — ${result.snippet}` : "";
  return `${result.title} (${result.url})${snippet}`;
}

function getAvailableSkills(pi: ExtensionAPI): ReadonlySet<string> {
  const skills = pi.getCommands()
    .filter((command) => command.source === "skill")
    .map((command) => normalizeSkillCommandName(command.name));
  return new Set(skills);
}

function tokenize(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}

function truncateForUi(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

function notify(ui: ImportWebUi | undefined, message: string, level: "info" | "warning" | "error"): void {
  ui?.notify(message, level);
}
