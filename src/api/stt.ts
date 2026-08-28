/**
 * Frontend client for VECTOR_CORE STT endpoint.
 * Sends recorded audio blob to the server for transcription.
 */

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  console.log(`[VECTOR_STT] Recording MIME type: ${audioBlob.type}`);
  console.log(`[VECTOR_STT] Recorded audio size: ${audioBlob.size} bytes`);

  if (!audioBlob || audioBlob.size === 0) {
    throw new Error("Recorded audio is empty. The microphone may not be capturing properly.");
  }

  const res = await fetch("/api/stt", {
    method: "POST",
    headers: {
      "Content-Type": audioBlob.type || "audio/webm",
    },
    body: audioBlob,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Speech-to-text failed.");
  }

  const data = await res.json();
  return data.text;
}
