/**
 * Frontend client for VECTOR_CORE TTS endpoint.
 * Sends text to the server, which speaks it in VECTOR's local deep android voice (Kokoro).
 */

/** WAV (VECTOR's local voice) starts with "RIFF"; the cloud voices return MP3. */
export function audioMime(buffer: ArrayBuffer): string {
  const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  return String.fromCharCode(...head) === "RIFF" ? "audio/wav" : "audio/mpeg";
}

/**
 * Playback rate of VECTOR's voice. Keep this at 1: the browser's pitch-preserving time-stretch
 * smears the android effect and makes him sound like a robot. Pace is set on the server instead
 * (VECTOR_VOICE_SPEED), where the voice model speeds up natively.
 */
export const SPEECH_PLAYBACK_RATE = 1;

/** Applies the speaking pace to an audio element (set as the default too, because loading a new src resets it). */
export function applySpeechRate(audio: HTMLAudioElement): void {
  audio.defaultPlaybackRate = SPEECH_PLAYBACK_RATE;
  audio.playbackRate = SPEECH_PLAYBACK_RATE;
  audio.preservesPitch = true;
}

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
