import OpenAI from "openai";
import type { ChatCompletionCreateParamsStreaming } from "groq-sdk/resources/chat/completions";

/**
 * Fallback language model: Google Gemini through its OpenAI-compatible endpoint.
 * VECTOR switches to it when Groq's daily allowance for the main model runs out.
 * The free tier may use prompts to improve Google's products, so it is a fallback, not the default.
 */

const apiKey = process.env.GEMINI_API_KEY;
export const geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const client = apiKey
  ? new OpenAI({
      apiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      maxRetries: 0, // the caller decides what to do next
    })
  : null;

export const geminiConfigured = client !== null;

// Gemini 3 signs each tool call and refuses a conversation that comes back without the signature.
// The chat loop doesn't know about that, so signatures are remembered here by tool-call id and put
// back on the way out. Calls Gemini never saw (made by Groq earlier in the same turn) get Google's
// documented placeholder.
const SKIP_VALIDATION = { google: { thought_signature: "skip_thought_signature_validator" } };
const signatures = new Map<string, unknown>();
const MAX_SIGNATURES = 200;

function remember(id: string, extra: unknown): void {
  signatures.set(id, extra);
  if (signatures.size > MAX_SIGNATURES) signatures.delete(signatures.keys().next().value as string);
}

function withSignatures(messages: OpenAI.Chat.ChatCompletionMessageParam[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role !== "assistant" || !m.tool_calls?.length) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map((c) => ({ ...c, extra_content: signatures.get(c.id) ?? SKIP_VALIDATION })),
    } as OpenAI.Chat.ChatCompletionAssistantMessageParam;
  });
}

/** A stream of OpenAI-shaped chunks that can be aborted, like Groq's. */
export interface CompletionStream extends AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  controller: AbortController;
}

/**
 * Same request VECTOR sends to Groq, answered by Gemini. Gemini's compatibility layer
 * leaves `index` off streamed tool calls, which the chat loop needs to stitch them
 * together, so it is filled in here.
 */
export async function createGeminiCompletion(params: ChatCompletionCreateParamsStreaming): Promise<CompletionStream> {
  if (!client) throw new Error("GEMINI_API_KEY is not configured.");
  const request = params as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming;
  const stream = await client.chat.completions.create({
    ...request,
    messages: withSignatures(request.messages),
    model: geminiModel,
    reasoning_effort: "low", // thinking tokens count against max_tokens
    stream_options: { include_usage: true },
  });

  return {
    controller: stream.controller,
    async *[Symbol.asyncIterator]() {
      let nextIndex = 0;
      for await (const chunk of stream) {
        for (const call of chunk.choices[0]?.delta?.tool_calls ?? []) {
          // Gemini sends each call whole, so every call without an index is a new one
          (call as { index?: number }).index ??= nextIndex++;
          const extra = (call as { extra_content?: unknown }).extra_content;
          if (call.id && extra) remember(call.id, extra);
        }
        yield chunk;
      }
    },
  };
}
