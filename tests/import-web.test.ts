import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  attachRequiredSourceTrace,
  buildDraftPrompt,
  extractYamlBlock,
  mapSkillsBestEffort,
  parseImportedPlaybookDraft,
} from "../src/import-web-draft.js";
import { handleImportWebCommand, parseImportWebArgs } from "../src/import-web-handlers.js";
import { createBraveSearchAdapter } from "../src/search-provider.js";
import { htmlToText } from "../src/url-content.js";
import type { PlaybookDefinition } from "../src/types.js";

const skills = new Set(["grill-with-docs", "to-prd", "to-issues"]);

function mockSkillCommands(names: string[]): Pick<ExtensionAPI, "getCommands"> {
  return {
    getCommands: () => names.map((name) => ({
      source: "skill" as const,
      name,
      sourceInfo: {
        path: `/virtual/${name}.md`,
        source: "test",
        scope: "temporary" as const,
        origin: "top-level" as const,
      },
    })),
  };
}

const sampleYaml = `
version: 1
id: imported-flow
name: Imported Flow
entry: grill
skills:
  grill-with-docs:
    role: entry
  to-prd:
    role: internal
steps:
  grill:
    primarySkill: grill-with-docs
    commandHint: "/skill:grill-with-docs"
    doneWhen:
      - Problem is clear.
    transitions:
      - outcome: ready-for-prd
        to: prd
  prd:
    primarySkill: to-prd
    commandHint: "/skill:to-prd"
    doneWhen:
      - PRD exists.
    transitions:
      - outcome: complete
        to: complete
`;

class MockUi {
  notifications: Array<{ message: string; level: string }> = [];
  confirms: string[] = [];
  confirmResults = [true, true];
  selectResult?: string;
  inputResult?: string;

  notify(message: string, level: "info" | "warning" | "error") {
    this.notifications.push({ message, level });
  }

  async confirm(title: string) {
    this.confirms.push(title);
    return this.confirmResults.shift() ?? false;
  }

  async select(_title: string, options: string[]) {
    return this.selectResult ?? options[0];
  }

  async input(_title: string) {
    return this.inputResult;
  }
}

test("parseImportWebArgs extracts query, urls, and id", () => {
  const parsed = parseImportWebArgs("feature workflow --url https://example.com/a --url https://example.com/b --id imported-flow");
  assert.equal(parsed.query, "feature workflow");
  assert.deepEqual(parsed.urls, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(parsed.id, "imported-flow");
});

test("buildDraftPrompt includes query, skills, and sources", () => {
  const prompt = buildDraftPrompt({
    query: "feature workflow",
    availableSkills: ["grill-with-docs"],
    sources: [{ url: "https://example.com/a", title: "Example", text: "Do step one then step two.", fetchedAt: "2026-07-03T00:00:00.000Z" }],
  });
  assert.match(prompt, /feature workflow/);
  assert.match(prompt, /grill-with-docs/);
  assert.match(prompt, /https:\/\/example.com\/a/);
});

test("parseImportedPlaybookDraft reads fenced yaml and applies target id", () => {
  const definition = parseImportedPlaybookDraft(["```yaml", sampleYaml, "```"].join("\n"), "forced-id");
  assert.equal(definition.id, "forced-id");
  assert.equal(definition.entry, "grill");
});

test("attachRequiredSourceTrace stores provenance metadata", () => {
  const definition = attachRequiredSourceTrace(parseImportedPlaybookDraft(sampleYaml), [
    { url: "https://example.com/a", title: "Example", text: "body", fetchedAt: "2026-07-03T00:00:00.000Z" },
  ]);
  assert.deepEqual(definition.sources, [
    { url: "https://example.com/a", title: "Example", accessedAt: "2026-07-03T00:00:00.000Z" },
  ]);
});

test("parseImportedPlaybookDraft rejects malformed drafts before skill mapping", () => {
  assert.throws(
    () => parseImportedPlaybookDraft("```yaml\nversion: 1\nid: bad\n```"),
    /Imported playbook draft is invalid/,
  );
});

test("mapSkillsBestEffort does not map ambiguous substring skill names", () => {
  const ambiguousSkills = new Set(["read-file"]);
  const definition: PlaybookDefinition = {
    version: 1,
    id: "ambiguous",
    name: "Ambiguous",
    entry: "step",
    skills: { "read-file": { role: "entry" } },
    steps: {
      step: {
        primarySkill: "delete-and-read-file",
        commandHint: "/skill:delete-and-read-file",
        doneWhen: ["ok"],
        transitions: [{ outcome: "complete", to: "complete" }],
      },
    },
  };

  const mapped = mapSkillsBestEffort(definition, ambiguousSkills);
  assert.equal(mapped.definition.steps.step.primarySkill, "delete-and-read-file");
  assert.deepEqual(mapped.missingSkills, ["delete-and-read-file"]);
});
test("mapSkillsBestEffort maps close skill names and reports missing ones", () => {
  const definition: PlaybookDefinition = {
    version: 1,
    id: "mapped",
    name: "Mapped",
    entry: "grill",
    skills: { "to-prd": { role: "internal" } },
    steps: {
      grill: {
        primarySkill: "Grill With Docs",
        commandHint: "/skill:grill-with-docs",
        doneWhen: ["ok"],
        transitions: [{ outcome: "next", to: "prd" }],
      },
      prd: {
        primarySkill: "unknown-skill",
        commandHint: "/skill:unknown-skill",
        doneWhen: ["ok"],
        transitions: [{ outcome: "complete", to: "complete" }],
      },
    },
  };

  const mapped = mapSkillsBestEffort(definition, skills);
  assert.equal(mapped.definition.steps.grill.primarySkill, "grill-with-docs");
  assert.deepEqual(mapped.missingSkills, ["unknown-skill"]);
});

test("createBraveSearchAdapter maps Brave API results", async () => {
  const fetchFn = async () => new Response(JSON.stringify({
    web: {
      results: [
        { url: "https://example.com/a", title: "A", description: "alpha" },
      ],
    },
  }), { status: 200 });

  const adapter = createBraveSearchAdapter("test-key", fetchFn as typeof fetch);
  const results = await adapter.search("feature workflow");
  assert.deepEqual(results, [{ url: "https://example.com/a", title: "A", snippet: "alpha" }]);
});

test("htmlToText strips basic markup", () => {
  const text = htmlToText("<html><head><title>T</title></head><body><h1>Hello</h1><p>World</p></body></html>");
  assert.match(text, /Hello/);
  assert.match(text, /World/);
  assert.doesNotMatch(text, /<h1>/);
});

test("handleImportWebCommand skips URL fetch when model drafting is unavailable", async () => {
  const ui = new MockUi();
  const pi = mockSkillCommands(["skill:grill-with-docs"]);
  let fetchCalled = false;

  await handleImportWebCommand(
    pi,
    "--url https://example.com/workflow",
    { cwd: tmpdir(), hasUI: true, ui },
    {
      fetchFn: async () => {
        fetchCalled = true;
        return new Response("body", { status: 200 });
      },
    },
  );

  assert.equal(fetchCalled, false);
  assert.match(ui.notifications.at(-1)?.message ?? "", /Model drafting is unavailable/);
});
test("handleImportWebCommand saves imported draft after model confirmation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-import-web-"));
  try {
    const ui = new MockUi();
    const pi = mockSkillCommands(["skill:grill-with-docs", "skill:to-prd"]);

    await handleImportWebCommand(
      pi,
      "--url https://example.com/workflow --id imported-flow",
      { cwd, hasUI: true, ui },
      {
        fetchFn: async () => new Response("<html><title>Workflow</title><body><p>Step one then PRD.</p></body></html>", { status: 200 }),
        modelDrafter: {
          draft: async () => ["```yaml", sampleYaml, "```"].join("\n"),
        },
        now: () => "2026-07-03T00:00:00.000Z",
      },
    );

    const saved = await readFile(join(cwd, ".pi/playbooks/imported-flow.yml"), "utf8");
    assert.match(saved, /id: imported-flow/);
    assert.match(saved, /sources:/);
    assert.match(saved, /https:\/\/example.com\/workflow/);
    assert.equal(ui.confirms[0], "Send model-assisted draft request?");
    assert.equal(ui.confirms[1], "Save Imported web playbook draft?");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("handleImportWebCommand blocks save when required skills remain missing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-playbook-import-web-missing-"));
  try {
    const ui = new MockUi();
    const pi = mockSkillCommands(["skill:grill-with-docs"]);

    await handleImportWebCommand(
      pi,
      "--url https://example.com/workflow",
      { cwd, hasUI: true, ui },
      {
        fetchFn: async () => new Response("plain text body", { status: 200 }),
        modelDrafter: {
          draft: async () => extractYamlBlock(sampleYaml),
        },
      },
    );

    const last = ui.notifications.at(-1);
    assert.equal(last?.level, "error");
    assert.match(last?.message ?? "", /missing skill mappings/i);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
