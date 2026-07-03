import { createRequire } from "node:module";
import type { ModelDraftRequest, ModelDrafter } from "../src/import-web-draft.js";
import { buildDraftPrompt } from "../src/import-web-draft.js";

const MODEL_DRAFT_TIMEOUT_MS = 120_000;

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

type PiAiModule = {
  streamSimple: (
    model: ModelLike,
    context: { messages: Array<{ role: string; content: string }> },
    options?: { apiKey?: string; headers?: Record<string, string>; maxTokens?: number },
  ) => AsyncIterable<{ type: string; delta?: string; error?: { message?: string } }>;
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
  const stream = piAi.streamSimple(model, {
    messages: [{ role: "user", content: prompt }],
  }, {
    apiKey: auth.apiKey,
    headers: auth.headers,
    maxTokens: 4096,
  });

  return consumeModelStream(stream, MODEL_DRAFT_TIMEOUT_MS);
}

async function consumeModelStream(
  stream: AsyncIterable<{ type: string; delta?: string; error?: { message?: string } }>,
  timeoutMs: number,
): Promise<string> {
  const iterator = stream[Symbol.asyncIterator]();
  const deadline = Date.now() + timeoutMs;
  let text = "";

  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Model drafting timed out after ${timeoutMs}ms.`);
      }

      const next = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Model drafting timed out after ${timeoutMs}ms.`)),
            remaining,
          );
        }),
      ]);

      if (next.done) break;

      const event = next.value;
      if (event.type === "text_delta") {
        text += event.delta ?? "";
      }
      if (event.type === "error") {
        throw new Error(event.error?.message ?? "Model drafting failed.");
      }
    }
  } finally {
    await iterator.return?.();
  }

  if (!text.trim()) {
    throw new Error("Model drafting returned an empty response.");
  }
  return text;
}

async function loadPiAiModule(): Promise<PiAiModule> {
  const require = createRequire(import.meta.url);
  const codingAgentEntry = require.resolve("@earendil-works/pi-coding-agent");
  const piAiEntry = require.resolve("@earendil-works/pi-ai", { paths: [codingAgentEntry] });
  return import(piAiEntry) as Promise<PiAiModule>;
}
