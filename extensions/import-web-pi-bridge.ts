import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { ModelDraftRequest, ModelDrafter } from "../src/import-web-draft.js";
import { buildDraftPrompt } from "../src/import-web-draft.js";

const MODEL_DRAFT_TIMEOUT_MS = 120_000;

type ImportWebModelContext = Pick<ExtensionCommandContext, "model" | "modelRegistry">;

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

  const prompt = buildDraftPrompt(request);
  const stream = ctx.modelRegistry.streamSimple(model, {
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  }, {
    maxTokens: 4096,
  });

  return consumeModelStream(stream, MODEL_DRAFT_TIMEOUT_MS);
}

async function consumeModelStream(
  stream: AsyncIterable<AssistantMessageEvent>,
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
        throw new Error(event.error.errorMessage ?? "Model drafting failed.");
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
