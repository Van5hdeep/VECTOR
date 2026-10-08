/**
 * Frontend client for VECTOR_CORE TTS endpoint.
 * Sends VECTOR's response text to the server, which proxies it to ElevenLabs or Fish Audio.
 * The API key never leaves the server.
 */

export async function synthesizeSpeech(text: string, provider: string = "elevenlabs"): Promise<ArrayBuffer> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, provider }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Voice synthesis unavailable.");
  }

  return res.arrayBuffer();
}
