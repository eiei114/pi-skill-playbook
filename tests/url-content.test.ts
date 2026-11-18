import test from "node:test";
import assert from "node:assert/strict";
import { htmlToText, fetchUrlContent, fetchUrlContents } from "../src/url-content.js";

const MAX_CONTENT_CHARS = 12_000;

test("htmlToText removes script and style blocks", () => {
  const html = `
    <html>
      <head>
        <style>body { color: red; }</style>
        <script>alert("x")</script>
      </head>
      <body>
        <p>Hello</p>
        <script type="text/javascript">console.log("y")</script>
        <style>.x{}</style>
        <p>World</p>
      </body>
    </html>
  `;
  const text = htmlToText(html);
  assert.match(text, /Hello/);
  assert.match(text, /World/);
  assert.doesNotMatch(text, /alert/);
  assert.doesNotMatch(text, /console\.log/);
  assert.doesNotMatch(text, /color:\s*red/);
  assert.doesNotMatch(text, /<script|<style/i);
});

test("htmlToText strips tags and decodes entities", () => {
  const html = "<div>&amp; &lt;tag&gt; &quot;hi&quot; &#39;bye&#39; &nbsp;space</div>";
  const text = htmlToText(html);
  assert.equal(text, "& <tag> \"hi\" 'bye' space");
});

test("htmlToText inserts newlines for block-level closing tags", () => {
  const html = [
    "<p>p</p>",
    "<div>div</div>",
    "<ul><li>li</li></ul>",
    "<h1>h1</h1><h2>h2</h2><h3>h3</h3><h4>h4</h4><h5>h5</h5><h6>h6</h6>",
    "a<br>b</br>c",
    "<table><tr><td>t</td></tr></table><p>end</p>",
  ].join("");
  const text = htmlToText(html);
  assert.match(text, /p\n/);
  assert.match(text, /div\n/);
  assert.match(text, /li\n/);
  assert.match(text, /h1\n/);
  assert.match(text, /h2\n/);
  assert.match(text, /h3\n/);
  assert.match(text, /h4\n/);
  assert.match(text, /h5\n/);
  assert.match(text, /h6\n/);
  assert.match(text, /b\n/);
  assert.match(text, /t\n/);
  assert.doesNotMatch(text, /<\w/);
});

test("htmlToText truncates long content with marker", () => {
  const long = "word ".repeat(4000); // ~20000 chars before normalization effects
  const text = htmlToText(`<body>${long}</body>`);
  assert.ok(text.length > MAX_CONTENT_CHARS, "expected truncated output to include marker beyond max chars");
  assert.match(text, /\n\.\.\.\[truncated\]$/);
  assert.ok(text.startsWith(long.slice(0, 50).trim()));
});

test("fetchUrlContent throws on non-OK responses with status text", async () => {
  const fetchFn = async () => new Response("nope", { status: 404, statusText: "Not Found" });
  await assert.rejects(
    () => fetchUrlContent("https://example.test/missing", fetchFn as typeof fetch),
    /Failed to fetch https:\/\/example\.test\/missing \(404 Not Found\)\./,
  );
});

test("fetchUrlContent returns trimmed non-HTML content without HTML parsing and extracts title from raw", async () => {
  const body = "  <p>Hello &amp; World</p>  ";
  const fetchFn = async () => new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

  const result = await fetchUrlContent("https://example.test/plain", fetchFn as typeof fetch, () => "2026-01-02T00:00:00.000Z");

  assert.equal(result.url, "https://example.test/plain");
  assert.equal(result.text, "<p>Hello &amp; World</p>");
  assert.equal(result.title, undefined);
  assert.equal(result.fetchedAt, "2026-01-02T00:00:00.000Z");
});

test("fetchUrlContent parses HTML content and extracts title", async () => {
  const html = `
    <html>
      <head><title>  Example   Title  </title></head>
      <body><h1>Hi</h1><p>There &amp; back</p></body>
    </html>
  `;
  const fetchFn = async () => new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

  const result = await fetchUrlContent("https://example.test/page", fetchFn as typeof fetch, () => "2026-01-03T00:00:00.000Z");

  assert.equal(result.title, "Example Title");
  assert.match(result.text, /Hi/);
  assert.match(result.text, /There & back/);
  assert.doesNotMatch(result.text, /<h1>/);
  assert.equal(result.fetchedAt, "2026-01-03T00:00:00.000Z");
});

test("fetchUrlContent truncates fetched content with marker", async () => {
  const long = "a".repeat(MAX_CONTENT_CHARS + 200);
  const fetchFn = async () => new Response(long, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });

  const result = await fetchUrlContent("https://example.test/long", fetchFn as typeof fetch);
  assert.match(result.text, /\n\.\.\.\[truncated\]$/);
  assert.equal(result.text.length, MAX_CONTENT_CHARS + "\n...[truncated]".length);
});

test("fetchUrlContents returns empty array for empty URL lists", async () => {
  const fetchFn = async () => {
    throw new Error("should not fetch");
  };
  const results = await fetchUrlContents([], fetchFn as typeof fetch);
  assert.deepEqual(results, []);
});

test("fetchUrlContents de-duplicates and trims URLs", async () => {
  const calls: string[] = [];
  const fetchFn = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return new Response(`<html><title>${url}</title><body>ok</body></html>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };

  const results = await fetchUrlContents(
    [" https://example.test/a ", "https://example.test/a", "", "https://example.test/b", "https://example.test/b"],
    fetchFn as typeof fetch,
    () => "2026-01-04T00:00:00.000Z",
  );

  assert.deepEqual(calls, ["https://example.test/a", "https://example.test/b"]);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.url), ["https://example.test/a", "https://example.test/b"]);
});
