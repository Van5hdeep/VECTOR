import { floatToInt16 } from "../lib/micCapture";

export type Sensitivity = "relaxed" | "normal" | "strict";

export interface VoiceprintStatus {
  enrolled: boolean;
  sensitivity: Sensitivity;
  windows?: number;
  createdAt?: string;
  threshold?: number;
}

export interface VerifyResult {
  enrolled: boolean;
  match: boolean;
  score: number;
  threshold: number;
}

const pcmBody = (pcm: Float32Array): BodyInit => {
  const samples = floatToInt16(pcm);
  return new Blob([samples.buffer as ArrayBuffer], { type: "application/octet-stream" });
};

/** Tell the voice engine the voiceprint changed (enrolled, removed, sensitivity). */
const notifyChanged = () => window.dispatchEvent(new Event("vector:voiceprint-changed"));

async function readStatus(res: Response): Promise<VoiceprintStatus> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Voice setup failed.");
  return data as VoiceprintStatus;
}

export async function getVoiceprintStatus(): Promise<VoiceprintStatus> {
  return readStatus(await fetch("/api/voice/voiceprint"));
}

export async function enrollVoiceprint(pcm: Float32Array): Promise<VoiceprintStatus> {
  const status = await readStatus(
    await fetch("/api/voice/voiceprint", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcmBody(pcm),
    })
  );
  notifyChanged();
  return status;
}

export async function removeVoiceprint(): Promise<VoiceprintStatus> {
  const status = await readStatus(await fetch("/api/voice/voiceprint", { method: "DELETE" }));
  notifyChanged();
  return status;
}

export async function setSensitivity(sensitivity: Sensitivity): Promise<VoiceprintStatus> {
  const status = await readStatus(
    await fetch("/api/voice/voiceprint/sensitivity", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sensitivity }),
    })
  );
  notifyChanged();
  return status;
}

/** Is this audio the owner's voice? `null` when the check itself failed. */
export async function verifyVoice(pcm: Float32Array, bargeIn: boolean): Promise<VerifyResult | null> {
  try {
    const res = await fetch(`/api/voice/verify${bargeIn ? "?bargeIn=1" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcmBody(pcm),
    });
    if (!res.ok) return null;
    return (await res.json()) as VerifyResult;
  } catch {
    return null;
  }
}
