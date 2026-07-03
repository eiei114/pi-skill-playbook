import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "./fetch-with-timeout.js";
import type { FetchLike } from "./search-provider.js";

export interface FetchedUrlContent {
  url: string;
  title?: string;
  text: string;
  fetchedAt: string;
}

const MAX_CONTENT_CHARS = 12_000;

export async function fetchUrlContents(
  urls: string[],
  fetchFn: FetchLike = fetch,
  now: () => string = () => new Date().toISOString(),
): Promise<FetchedUrlContent[]> {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];
  const results: FetchedUrlContent[] = [];

  for (const url of unique) {
    results.push(await fetchUrlContent(url, fetchFn, now));
  }

  return results;
}

export async function fetchUrlContent(
  url: string,
  fetchFn: FetchLike = fetch,
  now: () => string = () => new Date().toISOString(),
): Promise<FetchedUrlContent> {
  const response = await fetchWithTimeout(fetchFn, url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      "User-Agent": "pi-skill-playbook-import-web/1.0",
    },
  }, DEFAULT_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status} ${response.statusText}).`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  const title = extractHtmlTitle(raw);
  const text = contentType.includes("html") ? htmlToText(raw) : raw.trim();

  return {
    url,
    title,
    text: truncateText(text, MAX_CONTENT_CHARS),
    fetchedAt: now(),
  };
}

export function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = withoutScripts
    .replace(/<\/(p|div|li|h\d|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return truncateText(text.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim(), MAX_CONTENT_CHARS);
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || undefined;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}
