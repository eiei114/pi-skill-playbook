export interface SearchResult {
  url: string;
  title: string;
  snippet?: string;
}

export interface SearchProviderAdapter {
  readonly name: string;
  search(query: string, options?: { count?: number }): Promise<SearchResult[]>;
}

export type FetchLike = typeof fetch;

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export function resolveBraveSearchApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.BRAVE_SEARCH_API_KEY?.trim() || env.BRAVE_API_KEY?.trim() || undefined;
}

export function createBraveSearchAdapter(apiKey: string, fetchFn: FetchLike = fetch): SearchProviderAdapter {
  if (!apiKey.trim()) {
    throw new Error("Brave Search API key is required.");
  }

  return {
    name: "brave",
    async search(query: string, options: { count?: number } = {}): Promise<SearchResult[]> {
      const count = options.count ?? 5;
      const url = new URL(BRAVE_SEARCH_ENDPOINT);
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));

      const response = await fetchFn(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Brave Search request failed (${response.status} ${response.statusText}).`);
      }

      const payload = (await response.json()) as {
        web?: { results?: Array<{ url?: string; title?: string; description?: string }> };
      };

      return (payload.web?.results ?? [])
        .filter((result): result is { url: string; title?: string; description?: string } => Boolean(result.url))
        .map((result) => ({
          url: result.url,
          title: result.title?.trim() || result.url,
          snippet: result.description?.trim(),
        }));
    },
  };
}

export function createSearchProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: FetchLike = fetch,
): SearchProviderAdapter | undefined {
  const apiKey = resolveBraveSearchApiKey(env);
  if (!apiKey) return undefined;
  return createBraveSearchAdapter(apiKey, fetchFn);
}
