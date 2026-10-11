/**
 * Microphone → 16 kHz mono PCM. Speaker verification and the speech gate work on raw
 * samples, so the mic is tapped with an AudioWorklet instead of (only) a MediaRecorder.
 */

export const PCM_RATE = 16000;
/** 20 ms of audio per frame */
export const FRAME_SAMPLES = PCM_RATE / 50;

export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

const WORKLET_SOURCE = `
class Pcm16kTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${PCM_RATE};
    this.pos = 0; this.acc = 0; this.count = 0;
    this.frame = new Float32Array(${FRAME_SAMPLES}); this.n = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.acc += channel[i]; this.count++; this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        this.frame[this.n++] = this.acc / this.count;
        this.acc = 0; this.count = 0;
        if (this.n === ${FRAME_SAMPLES}) {
          this.port.postMessage(this.frame, [this.frame.buffer]);
          this.frame = new Float32Array(${FRAME_SAMPLES}); this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm16k-tap", Pcm16kTap);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

function loadWorklet(ctx: AudioContext): Promise<void> {
  let ready = loaded.get(ctx);
  if (!ready) {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    ready = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    loaded.set(ctx, ready);
  }
  return ready;
}

/** Stream 20 ms Float32 frames (16 kHz) from a mic source. Returns a function that detaches the tap. */
export async function tapPcm(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  onFrame: (frame: Float32Array) => void
): Promise<() => void> {
  await loadWorklet(ctx);
  const node = new AudioWorkletNode(ctx, "pcm16k-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
  node.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data);
  // Some browsers only pull nodes that reach the destination; a muted gain keeps the mic silent
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute).connect(ctx.destination);
  return () => {
    node.port.onmessage = null;
    try { source.disconnect(node); } catch { /* already disconnected */ }
    try { node.disconnect(); mute.disconnect(); } catch { /* already disconnected */ }
  };
}

export function floatToInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767);
  }
  return out;
}

/** 16-bit mono WAV, accepted by the speech-to-text endpoint. */
export function encodeWav(pcm: Float32Array, rate = PCM_RATE): Blob {
  const samples = floatToInt16(pcm);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  new Int16Array(buffer, 44).set(samples);
  return new Blob([buffer], { type: "audio/wav" });
}

export function concatFrames(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let offset = 0;
  for (const f of frames) {
    out.set(f, offset);
    offset += f.length;
  }
  return out;
}

export function frameRms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}
