import type { TelemetryData } from "../types/vector";
import type { VectorContextState } from "../types/context";
import type { PendingAction } from "./actions";

export interface StreamHandlers {
  onConversation?: (conversationId: number) => void;
  /** A sensitive tool call is waiting for the user's approval */
  onConfirm?: (action: PendingAction) => void;
  /** A pending action was approved/denied by a typed or spoken yes/no */
  onActionResolved?: (actionId: string) => void;
  /** VECTOR started using a tool (e.g. web_search) */
  onTool?: (name: string, detail?: string) => void;
  /** Abort to stop generating */
  signal?: AbortSignal;
}

/**
 * Send a message to VECTOR_CORE. Conversation history is stored server-side,
 * so only the conversation id travels with each request.
 */
export async function sendMessage(
  message: string,
  conversationId: number | null,
  isVoice: boolean,
  onChunk: (text: string) => void,
  onTelemetry?: (data: TelemetryData) => void,
  vectorContext?: VectorContextState,
  handlers: StreamHandlers = {}
): Promise<void> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, conversationId, isVoice, clientContext: vectorContext }),
      signal: handlers.signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onChunk(data.error || "Something went wrong. Please try again.");
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No readable stream");

    const decoder = new TextDecoder("utf-8");
    let done = false;
    let buffer = "";

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.substring(6);
            if (dataStr === "[DONE]") continue;
            try {
              const data = JSON.parse(dataStr);
              if (typeof data.conversationId === "number") {
                handlers.onConversation?.(data.conversationId);
              }
              if (data.confirm) {
                handlers.onConfirm?.(data.confirm);
              }
              if (data.tool) {
                handlers.onTool?.(data.tool, data.detail);
              }
              if (data.actionResolved) {
                handlers.onActionResolved?.(data.actionResolved);
              }
              if (data.text) {
                onChunk(data.text);
              }
              if (data.telemetry && onTelemetry) {
                onTelemetry(data.telemetry);
              }
            } catch (e) {
              // Ignore partial JSON parsing errors
            }
          }
        }
      }
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return; // The user pressed Stop
    onChunk("I can't reach my core right now. Check that the VECTOR server is running.");
  }
}
