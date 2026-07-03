import { createRequire } from "node:module";
import type { ModelDraftRequest, ModelDrafter } from "./import-web-draft.js";
import { buildDraftPrompt } from "./import-web-draft.js";
type ModelLike = {
  provider: string;
  id: string;
};

type ModelRegistryLike = {
  getApiKeyAndHeaders(model: ModelLike): Promise<
    | { ok: true; apiKey?: string; headers?: Record<string, string> }
    | { ok: false; error: string }
  >;
};

type ImportWebModelContext = {
  model: ModelLike | undefined;
  modelRegistry: ModelRegistryLike;
};

export function createModelDrafterFromContext(ctx: ImportWebModelContext): ModelDrafter | undefined {
  if (!ctx.model) return undefined;
  return {
    draft: (request) => draftWithActiveModel(ctx, request),
  };
}

async function draftWithActiveModel(ctx: ImportWebModelContext, request: ModelDraftRequest): Promise<string> {
  const model = ctx.model;
  if (!model) {
    throw new Error("No active Pi model is configured for import-web drafting.");
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(auth.error);
  }

  const prompt = buildDraftPrompt(request);
  const piAi = await loadPiAiModule();
  const context = {
    messages: [{ role: "user", content: prompt }],
  };

  const stream = piAi.streamSimple(model, context, {
    apiKey: auth.apiKey,
    headers: auth.headers,
    maxTokens: 4096,
  });

  let text = "";
  for await (const event of stream) {
    if (event.type === "text_delta") {
      text += event.delta;
    }
    if (event.type === "error") {
      throw new Error(event.error?.message ?? "Model drafting failed.");
    }
  }

  if (!text.trim()) {
    throw new Error("Model drafting returned an empty response.");
  }
  return text;
}

type PiAiModule = {
  streamSimple: (
    model: ModelLike,
    context: { messages: Array<{ role: string; content: string }> },
    options?: { apiKey?: string; headers?: Record<string, string>; maxTokens?: number },
  ) => AsyncIterable<{ type: string; delta?: string; error?: { message?: string } }>;
};

async function loadPiAiModule(): Promise<PiAiModule> {
  const require = createRequire(import.meta.url);
  const codingAgentEntry = require.resolve("@earendil-works/pi-coding-agent");
  const piAiEntry = require.resolve("@earendil-works/pi-ai", { paths: [codingAgentEntry] });
  return import(piAiEntry) as Promise<PiAiModule>;
}
