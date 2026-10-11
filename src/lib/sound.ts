import { synthesizeSpeech, audioMime, applySpeechRate } from "../api/tts";

let ctx: AudioContext | null = null;

function audioContext(): AudioContext {
  if (!ctx || ctx.state === "closed") ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Short synthesized "systems online" chime — no audio assets needed. */
export function playChime(): void {
  try {
    const ac = audioContext();
    const now = ac.currentTime;
    const master = ac.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.22, now + 0.04);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    master.connect(ac.destination);

    // Rising sweep + a bright fifth on top
    for (const [freq, end, delay, type] of [
      [220, 660, 0, "sine"],
      [330, 990, 0.12, "triangle"],
    ] as const) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(end, now + delay + 0.5);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.5, now + delay + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 1.1);
      osc.connect(gain).connect(master);
      osc.start(now + delay);
      osc.stop(now + delay + 1.2);
    }
  } catch {
    // Audio unavailable: silent is fine
  }
}

/** VECTOR greets the user in his deep android voice (server-cached), or the browser's voice as a fallback. */
export async function speakWelcome(text = "Welcome back. All systems are online."): Promise<void> {
  try {
    const buffer = await synthesizeSpeech(text);
    const url = URL.createObjectURL(new Blob([buffer], { type: audioMime(buffer) }));
    const audio = new Audio(url);
    applySpeechRate(audio);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch {
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  }
}
