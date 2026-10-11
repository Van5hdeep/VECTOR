import crypto from "crypto";
import { fork, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DATA_DIR } from "./db.js";

/**
 * Speaker verification: is this audio the owner's voice?
 *
 * NVIDIA TitaNet-small (speaker embeddings, 40 MB) runs locally on the CPU in a
 * worker process. The owner enrols once; the browser then sends short candidate
 * segments and gets back a cosine score against the stored voiceprint.
 * Nothing leaves the PC except the one-time model download.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL_ID = "titanet-small-v1";
const MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx";
const MODEL_SHA256 = "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e";
const MODEL_FILE = path.join(DATA_DIR, "models", "nemo_en_titanet_small.onnx");
const WORKER_FILE = path.join(__dirname, "speaker.worker.cjs");
const REQUEST_TIMEOUT_MS = 60_000;

export const SAMPLE_RATE = 16000;

const VOICEPRINT_FILE = path.join(DATA_DIR, "voiceprint.json");
const ENROLL_WINDOW = Math.round(SAMPLE_RATE * 1.5);
const ENROLL_HOP = Math.round(SAMPLE_RATE * 0.75);
const MIN_ENROLL_WINDOWS = 8;
const MAX_ENROLL_WINDOWS = 80;
const MIN_VERIFY_SAMPLES = Math.round(SAMPLE_RATE * 0.4);
const MAX_VERIFY_SAMPLES = SAMPLE_RATE * 6;
const BARGE_IN_MARGIN = 0.03;
const OUTLIER_BELOW_MEDIAN = 0.2;

export type Sensitivity = "relaxed" | "normal" | "strict";
const SENSITIVITY_OFFSET: Record<Sensitivity, number> = { relaxed: -0.06, normal: 0, strict: 0.06 };
// In tests the owner scored ~0.75-0.95 and 11 similar voices stayed below ~0.46
const MIN_THRESHOLD = 0.4;
const MAX_THRESHOLD = 0.55;
const THRESHOLD_BELOW_MEDIAN = 0.3;

interface Voiceprint {
  model: string;
  createdAt: string;
  centroid: number[];
  /** Median leave-one-out similarity of the enrolment windows, used to set the base threshold */
  median: number;
  threshold: number;
  windows: number;
  sensitivity: Sensitivity;
}

export interface VoiceprintStatus {
  enrolled: boolean;
  sensitivity: Sensitivity;
  windows?: number;
  createdAt?: string;
  threshold?: number;
}

// ─── Model & worker ──────────────────────────────────────────

let downloading: Promise<string> | null = null;

/** First use downloads the model once, checks its hash and keeps it in the data folder. */
function ensureModel(): Promise<string> {
  downloading ??= (async () => {
    if (fs.existsSync(MODEL_FILE)) return MODEL_FILE;
    fs.mkdirSync(path.dirname(MODEL_FILE), { recursive: true });
    console.log("[VECTOR_SPEAKER] Downloading voiceprint model (40 MB, one time)…");
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`Voiceprint model download failed (${res.status}).`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== MODEL_SHA256) {
      throw new Error("Voiceprint model download did not match its expected checksum.");
    }
    const partial = `${MODEL_FILE}.part`;
    fs.writeFileSync(partial, bytes);
    fs.renameSync(partial, MODEL_FILE);
    return MODEL_FILE;
  })().catch((err) => {
    downloading = null;
    throw err;
  });
  return downloading;
}

interface Pending {
  resolve: (value: { embedding?: Float32Array }) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

let workerPromise: Promise<ChildProcess> | null = null;
const pending = new Map<number, Pending>();
let nextId = 1;

function request(child: ChildProcess, message: Record<string, unknown>): Promise<{ embedding?: Float32Array }> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Voice check timed out."));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    child.send({ id, ...message }, (err) => {
      if (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      }
    });
  });
}

function getWorker(): Promise<ChildProcess> {
  workerPromise ??= (async () => {
    const model = await ensureModel();
    const child = fork(WORKER_FILE, [], { serialization: "advanced", execArgv: [], stdio: ["ignore", "inherit", "inherit", "ipc"] });
    child.on("message", (msg: { id: number; error?: string; embedding?: Float32Array }) => {
      const entry = pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error));
      else entry.resolve(msg);
    });
    child.on("exit", () => {
      workerPromise = null;
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Voice check worker stopped."));
        pending.delete(id);
      }
    });
    await request(child, { type: "init", model });
    return child;
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

function normalize(v: ArrayLike<number>): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

async function embed(pcm: Float32Array): Promise<Float32Array> {
  const child = await getWorker();
  const { embedding } = await request(child, { type: "embed", samples: pcm });
  if (!embedding) throw new Error("No embedding returned.");
  return normalize(embedding);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

function centroidOf(vectors: Float32Array[]): Float32Array {
  const sum = new Float32Array(vectors[0].length);
  for (const v of vectors) for (let i = 0; i < sum.length; i++) sum[i] += v[i];
  return normalize(sum);
}

// ─── Storage ─────────────────────────────────────────────────

let cached: Voiceprint | null | undefined;

function loadVoiceprint(): Voiceprint | null {
  if (cached !== undefined) return cached;
  try {
    const stored = JSON.parse(fs.readFileSync(VOICEPRINT_FILE, "utf8")) as Voiceprint;
    // A voiceprint made with an older model cannot be compared with this one: enrol again
    cached = stored.model === MODEL_ID ? stored : null;
  } catch {
    cached = null;
  }
  return cached;
}

function saveVoiceprint(vp: Voiceprint | null): void {
  cached = vp;
  if (vp) fs.writeFileSync(VOICEPRINT_FILE, JSON.stringify(vp), { mode: 0o600 });
  else fs.rmSync(VOICEPRINT_FILE, { force: true });
}

export function voiceprintStatus(): VoiceprintStatus {
  const vp = loadVoiceprint();
  if (!vp) return { enrolled: false, sensitivity: "normal" };
  return {
    enrolled: true,
    sensitivity: vp.sensitivity,
    windows: vp.windows,
    createdAt: vp.createdAt,
    threshold: effectiveThreshold(vp, false),
  };
}

export function clearVoiceprint(): VoiceprintStatus {
  saveVoiceprint(null);
  return voiceprintStatus();
}

export function setSensitivity(sensitivity: Sensitivity): VoiceprintStatus {
  const vp = loadVoiceprint();
  if (vp) saveVoiceprint({ ...vp, sensitivity });
  return voiceprintStatus();
}

/** Warm the model in the background when a voiceprint exists, so the first check isn't slow. */
export function preloadSpeaker(): void {
  if (!loadVoiceprint()) return;
  getWorker().then(
    () => console.log("[VECTOR_SPEAKER] Voiceprint model ready"),
    (err) => console.warn("[VECTOR_SPEAKER] Voiceprint model unavailable:", (err as Error).message)
  );
}

// ─── Enrolment ───────────────────────────────────────────────

function frameRms(pcm: Float32Array, frame: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + frame <= pcm.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += pcm[j] * pcm[j];
    out.push(Math.sqrt(sum / frame));
  }
  return out;
}

/** Windows of the recording that are mostly speech, so silence never ends up in the voiceprint. */
function voicedWindows(pcm: Float32Array): Float32Array[] {
  const frame = SAMPLE_RATE / 50; // 20 ms
  const rms = frameRms(pcm, frame);
  if (rms.length === 0) return [];
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)];
  const gate = Math.max(0.008, floor * 3);

  const windows: Float32Array[] = [];
  for (let start = 0; start + ENROLL_WINDOW <= pcm.length; start += ENROLL_HOP) {
    const first = start / frame;
    const count = ENROLL_WINDOW / frame;
    let voiced = 0;
    for (let i = 0; i < count; i++) if ((rms[first + i] ?? 0) > gate) voiced++;
    if (voiced / count >= 0.75) windows.push(pcm.subarray(start, start + ENROLL_WINDOW));
  }
  return windows;
}

export async function enrollVoiceprint(pcm: Float32Array): Promise<VoiceprintStatus> {
  const windows = voicedWindows(pcm).slice(0, MAX_ENROLL_WINDOWS);
  if (windows.length < MIN_ENROLL_WINDOWS) {
    throw new Error("Not enough clear speech to learn your voice. Speak a little longer, closer to the mic.");
  }

  let embeddings: Float32Array[] = [];
  for (const w of windows) embeddings.push(await embed(w));

  // Drop windows that don't sound like the rest (pauses, coughs, a passing voice)
  const first = embeddings.map((e) => cosine(e, centroidOf(embeddings)));
  const cutoff = median(first) - OUTLIER_BELOW_MEDIAN;
  const kept = embeddings.filter((_, i) => first[i] >= cutoff);
  if (kept.length >= MIN_ENROLL_WINDOWS) embeddings = kept;

  // Calibrate: how similar is each window to the rest of the owner's own speech?
  // Neighbouring windows overlap, so leave out the closest ones as well.
  const sims: number[] = [];
  for (let i = 0; i < embeddings.length; i++) {
    const others = embeddings.filter((_, j) => Math.abs(j - i) > 2);
    if (others.length >= 3) sims.push(cosine(embeddings[i], centroidOf(others)));
  }
  const selfSimilarity = sims.length ? median(sims) : median(first);
  const threshold = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, selfSimilarity - THRESHOLD_BELOW_MEDIAN));

  const previous = loadVoiceprint();
  saveVoiceprint({
    model: MODEL_ID,
    createdAt: new Date().toISOString(),
    centroid: Array.from(centroidOf(embeddings)),
    median: selfSimilarity,
    threshold,
    windows: embeddings.length,
    sensitivity: previous?.sensitivity ?? "normal",
  });
  console.log(
    `[VECTOR_SPEAKER] Voiceprint saved: ${embeddings.length} windows, median self-similarity ${selfSimilarity.toFixed(3)}, threshold ${threshold.toFixed(3)}`
  );
  return voiceprintStatus();
}

// ─── Verification ────────────────────────────────────────────

function effectiveThreshold(vp: Voiceprint, bargeIn: boolean): number {
  return Math.min(0.95, vp.threshold + SENSITIVITY_OFFSET[vp.sensitivity] + (bargeIn ? BARGE_IN_MARGIN : 0));
}

export interface VerifyResult {
  enrolled: boolean;
  match: boolean;
  score: number;
  threshold: number;
}

/**
 * Compare a candidate segment to the owner's voiceprint. While VECTOR is talking
 * (`bargeIn`) the bar is a little higher, so only the owner can cut him off.
 */
export async function verifySpeaker(pcm: Float32Array, bargeIn: boolean): Promise<VerifyResult> {
  const vp = loadVoiceprint();
  if (!vp) return { enrolled: false, match: true, score: 1, threshold: 0 };
  if (pcm.length < MIN_VERIFY_SAMPLES) {
    return { enrolled: true, match: false, score: 0, threshold: effectiveThreshold(vp, bargeIn) };
  }
  const clip = pcm.length > MAX_VERIFY_SAMPLES ? pcm.subarray(pcm.length - MAX_VERIFY_SAMPLES) : pcm;
  const score = cosine(await embed(clip), vp.centroid);
  const threshold = effectiveThreshold(vp, bargeIn);
  return { enrolled: true, match: score >= threshold, score, threshold };
}

/** Raw little-endian Int16 PCM (16 kHz mono) from the browser → Float32 in [-1, 1]. */
export function pcmFromInt16(buf: Buffer): Float32Array {
  const samples = Math.floor(buf.length / 2);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}
