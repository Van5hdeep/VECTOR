/**
 * Frontend client for VECTOR_CORE TTS endpoint.
 * Sends VECTOR's response text to the server, which proxies it to ElevenLabs.
 * The API key never leaves the server.
 */

export async function synthesizeSpeech(text: string): Promise<ArrayBuffer> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Voice synthesis unavailable.");
  }

  return res.arrayBuffer();
}
