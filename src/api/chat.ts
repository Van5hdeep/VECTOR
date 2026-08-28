import type { ChatMessage, TelemetryData } from "../types/vector";
import type { VectorContextState } from "../types/context";

export async function sendMessage(
  message: string,
  history: ChatMessage[],
  isVoice: boolean,
  onChunk: (text: string) => void,
  onTelemetry?: (data: TelemetryData) => void,
  vectorContext?: VectorContextState
): Promise<void> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, isVoice, clientContext: vectorContext }),
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
  } catch {
    onChunk("Unable to reach VECTOR_CORE. Please ensure the server is running.");
  }
}
