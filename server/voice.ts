import { KokoroTTS } from "kokoro-js";

/**
 * VECTOR's own voice: Kokoro (open-weight, Apache-2.0) running locally on the
 * CPU — free, no API key, no limits — with a deep "android" treatment.
 * Voice: am_michael. The android treatment lowers the pitch by resampling, which also
 * stretches the audio by ~9%. Pace comes from the model speed (and trimmed silence), never from stretching the audio, which sounds robotic.
 */

const VOICE = "am_michael";
// Override with VECTOR_VOICE_SPEED (1.0 = model default; raise for faster, lower for slower)
const SPEED = Number(process.env.VECTOR_VOICE_SPEED) || 1.35;
const GAP_SECONDS = 0.07;

let ttsPromise: Promise<KokoroTTS> | null = null;

function getTTS(): Promise<KokoroTTS> {
  // First use downloads the quantized model (~90 MB) to the Hugging Face cache
  ttsPromise ??= KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" }).catch(
    (err) => {
      ttsPromise = null;
      throw err;
    }
  );
  return ttsPromise;
}

/** Warm the model in the background so the first reply isn't slow. */
export function preloadVoice(): void {
  getTTS().then(
    () => console.log("[VECTOR_VOICE] Local voice ready (Kokoro am_michael)"),
    (err) => console.warn("[VECTOR_VOICE] Local voice unavailable:", (err as Error).message)
  );
}

/** Speech shouldn't read markdown, code or URLs aloud. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " I've put the code on screen. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link on screen")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, " the formula on screen ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_~>|#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentence chunks small enough for the model's context. */
function chunks(text: string, max = 280): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) ?? [text];
  const out: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > max && current) {
      out.push(current.trim());
      current = "";
    }
    current += s;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Deep android treatment: pitch down ~8% (resample), short metallic comb
 * resonance, a light 42 Hz ring modulation and soft saturation.
 */
function android(input: Float32Array, rate: number): Float32Array {
  const ratio = 0.92;
  const n = Math.floor(input.length / ratio);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio, j = Math.floor(p), f = p - j;
    x[i] = (input[j] ?? 0) * (1 - f) + (input[j + 1] ?? 0) * f;
  }
  const out = new Float32Array(n);
  const d1 = Math.round(rate * 0.0045), d2 = Math.round(rate * 0.0071);
  for (let i = 0; i < n; i++) {
    const comb = x[i] + 0.35 * (i >= d1 ? out[i - d1] : 0) + 0.2 * (i >= d2 ? out[i - d2] : 0);
    const ring = comb * (0.82 + 0.18 * Math.sin((2 * Math.PI * 42 * i) / rate));
    out[i] = Math.tanh(ring * 1.25) * 0.8;
  }
  return out;
}

function toWav(samples: Float32Array, rate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/**
 * Kokoro pads every clip with a little silence at both ends. Trimming it makes speech
 * quicker without touching the voice itself (no stretching, so no artifacts).
 */
function trimSilence(samples: Float32Array, rate: number, threshold = 0.012, keepSeconds = 0.025): Float32Array {
  let start = 0;
  let end = samples.length;
  while (start < end && Math.abs(samples[start]) < threshold) start++;
  while (end > start && Math.abs(samples[end - 1]) < threshold) end--;
  const keep = Math.round(rate * keepSeconds);
  return samples.subarray(Math.max(0, start - keep), Math.min(samples.length, end + keep));
}

export interface VoiceOptions {
  voice?: string;
  speed?: number;
  /** Silence between sentences, in seconds */
  gap?: number;
}

/** Synthesize VECTOR's voice as a WAV buffer. */
export async function synthesizeLocal(text: string, options: VoiceOptions = {}): Promise<Buffer> {
  const { voice = VOICE, speed = SPEED, gap = GAP_SECONDS } = options;
  const tts = await getTTS();
  const parts: Float32Array[] = [];
  let rate = 24000;
  for (const chunk of chunks(cleanForSpeech(text))) {
    const audio = await tts.generate(chunk, { voice: voice as "am_michael", speed });
    rate = audio.sampling_rate;
    parts.push(trimSilence(audio.audio as Float32Array, rate));
    parts.push(new Float32Array(Math.round(rate * gap)));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const joined = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    joined.set(p, offset);
    offset += p.length;
  }
  return toWav(android(joined, rate), rate);
}
