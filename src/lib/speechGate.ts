import { concatFrames, frameRms } from "./micCapture";

/**
 * Decides which sounds count as the owner talking to VECTOR.
 *
 * Loudness alone is never enough: a burst of sound only becomes a *candidate*, and a
 * candidate only counts once the voiceprint check says it is the owner's voice. That one
 * decision drives both listening (a turn starts and ends with the owner's speech, not with
 * room noise) and barge-in (VECTOR stops talking only for the owner, with a higher bar).
 *
 * Time is counted in 20 ms frames so the logic is deterministic and easy to test.
 */

export type GateMode = "off" | "listening" | "speaking";

export interface GateVerdict {
  match: boolean;
  score: number;
}

/** Resolves to `null` when the check itself failed. */
export type GateVerifier = (pcm: Float32Array, bargeIn: boolean) => Promise<GateVerdict | null>;

export interface SpeechGateEvents {
  /** The owner's voice is confirmed. While VECTOR is speaking this is the cue to stop. */
  onOwnerSpeech(): void;
  /** A finished turn: the owner's speech only, trimmed of leading/trailing background. The gate then turns itself off. */
  onUtterance(pcm: Float32Array): void;
  /** The voice check keeps failing (model still loading, server down). */
  onVerifierTrouble?(): void;
  onVerdict?(verdict: GateVerdict | null, bargeIn: boolean): void;
}

const MIN_ENERGY = 0.012; // frame RMS below this is never speech
const FLOOR_MARGIN = 2.5; // speech must stand out from the room by this factor
const MAX_FLOOR = 0.03;

const PRE_ROLL = 15; // 300 ms kept from before the sound crossed the threshold
const START_LOUD = 6; // 120 ms of sound opens a candidate when a voiceprint exists
const START_LOUD_UNGATED = 10; // without a voiceprint, ask for a little more

const WINDOW = 75; // 1.5 s of audio per voiceprint check
const FIRST_VERIFY = 40; // wait for ~0.8 s of audio (pre-roll included) before the first check
const MIN_WINDOW_LOUD = 0.4; // share of the window that must be loud, or it is mostly silence
const MAX_UNCONFIRMED = 200; // keep at most 4 s of a candidate nobody has vouched for
const MIN_FINAL_VERIFY = 25; // a short phrase ("stop") still gets one check at the end
const MIN_LOUD = 15; // 300 ms of sound for a turn to be worth transcribing

const CANDIDATE_QUIET = 30; // 0.6 s of quiet closes an unconfirmed candidate
const END_QUIET = 60; // 1.2 s of quiet ends the owner's turn
const UNMATCHED_LOUD = 60; // 1.2 s of sound that is not the owner ends the turn (pauses do not count)
const TAIL_QUIET = 8;
const TAIL_MATCH = 15;
const LEAD_TRIM = 30; // keep 0.6 s before the first window that matched
const MAX_UTTERANCE = 2250; // 45 s

type Phase = "idle" | "candidate" | "active" | "deciding";

interface Entry {
  frame: Float32Array;
  loud: boolean;
}

export class SpeechGate {
  private mode: GateMode = "off";
  private phase: Phase = "idle";
  private idx = 0;
  private noiseFloor = 0.004;
  private loudRun = 0;

  private preRoll: Entry[] = [];
  private entries: Entry[] = [];
  private segStart = 0; // frame index of entries[0]
  private lastLoud = 0;
  private loudFrames = 0;

  private epoch = 0; // bumped on every reset so late verdicts are ignored
  private inFlight = false;
  private pendingDecision = false;
  private lastVerify = -Infinity;
  private failures = 0;
  private matches = 0;
  private lastMatchEnd = -1;
  private firstMatchStart = -1;
  private rejectedBeforeMatch = false;
  private verifierFailures = 0;

  private events: SpeechGateEvents;
  private verify: GateVerifier | null;

  constructor(events: SpeechGateEvents, verify: GateVerifier | null) {
    this.events = events;
    this.verify = verify;
  }

  /** Swap the voiceprint check (or `null` to listen to everyone). Drops any turn in progress. */
  setVerifier(verify: GateVerifier | null): void {
    this.verify = verify;
    this.resetState();
  }

  setMode(mode: GateMode): void {
    this.mode = mode;
    if (mode === "off") this.resetState();
  }

  /** True while the owner's voice is confirmed and the turn is open. */
  get hearingOwner(): boolean {
    return this.phase === "active";
  }

  push(frame: Float32Array): void {
    this.idx++;
    const rms = frameRms(frame);
    const loud = rms > Math.max(MIN_ENERGY, this.noiseFloor * FLOOR_MARGIN);
    if (!loud) {
      this.loudRun = 0;
      this.noiseFloor = Math.min(MAX_FLOOR, this.noiseFloor * 0.98 + rms * 0.02);
    } else if (++this.loudRun > 150) {
      // A steady hum for 3 s is the room, not speech: let the floor creep up to it
      this.noiseFloor = Math.min(MAX_FLOOR, this.noiseFloor * 0.995 + rms * 0.005);
    }
    if (this.mode === "off") return;

    const entry: Entry = { frame, loud };
    if (this.phase === "idle") {
      this.preRoll.push(entry);
      if (this.preRoll.length > PRE_ROLL) this.preRoll.shift();
      if (this.loudRun >= (this.verify ? START_LOUD : START_LOUD_UNGATED)) this.begin();
    } else if (this.phase !== "deciding") {
      this.append(entry);
      this.advance();
    }
  }

  // ─── Turn lifecycle ────────────────────────────────────────

  private begin(): void {
    this.entries = this.preRoll;
    this.preRoll = [];
    this.segStart = this.idx - this.entries.length + 1;
    this.lastLoud = this.idx;
    this.loudFrames = this.entries.filter((e) => e.loud).length;
    if (this.verify) {
      this.phase = "candidate";
    } else {
      this.phase = "active";
      this.events.onOwnerSpeech();
    }
  }

  private append(entry: Entry): void {
    this.entries.push(entry);
    if (entry.loud) {
      this.lastLoud = this.idx;
      this.loudFrames++;
    }
    if (this.phase === "candidate" && this.entries.length > MAX_UNCONFIRMED) {
      const drop = this.entries.length - MAX_UNCONFIRMED;
      this.entries.splice(0, drop);
      this.segStart += drop;
    }
  }

  private advance(): void {
    const quiet = this.idx - this.lastLoud;
    if (this.phase === "candidate") {
      if (quiet >= CANDIDATE_QUIET) {
        void this.decideCandidate();
        return;
      }
    } else {
      if (quiet >= END_QUIET) return this.finish(this.lastLoud + TAIL_QUIET);
      if (this.verify && !this.inFlight && this.loudSinceMatch() >= UNMATCHED_LOUD) {
        return this.finish(this.lastMatchEnd + TAIL_MATCH);
      }
      if (this.entries.length >= MAX_UTTERANCE) return this.finish(this.idx);
    }
    this.maybeVerify();
  }

  /** Sound ended before anyone vouched for it: one last check over the whole phrase. */
  private async decideCandidate(): Promise<void> {
    if (this.inFlight) {
      this.pendingDecision = true;
      return;
    }
    const end = Math.min(this.entries.length, this.lastLoud - this.segStart + 1 + TAIL_QUIET);
    // Start just before the first sound: silence in the clip only dilutes the voiceprint score
    const firstLoud = this.entries.findIndex((e) => e.loud);
    const clip = this.entries.slice(Math.max(0, end - WINDOW * 2, firstLoud - 3), end);
    if (!this.verify || this.loudFrames < MIN_LOUD || clip.length < MIN_FINAL_VERIFY) {
      this.resetState();
      return;
    }
    this.phase = "deciding";
    const epoch = this.epoch;
    // The sound is over and this is the whole phrase, so the ordinary bar applies even while
    // VECTOR is talking; the stricter barge-in bar is for cutting him off mid-sentence.
    const bargeIn = false;
    let verdict: GateVerdict | null = null;
    try {
      verdict = await this.verify(concatFrames(clip.map((e) => e.frame)), bargeIn);
    } catch {
      verdict = null;
    }
    if (epoch !== this.epoch) return;
    this.events.onVerdict?.(verdict, bargeIn);
    if (verdict?.match) {
      this.phase = "active";
      this.events.onOwnerSpeech();
      this.finish(this.lastLoud + TAIL_QUIET);
    } else {
      this.resetState();
    }
  }

  /** Loud frames after the newest window the owner's voice was found in. */
  private loudSinceMatch(): number {
    let n = 0;
    for (let i = this.entries.length - 1; i >= 0 && this.segStart + i > this.lastMatchEnd; i--) {
      if (this.entries[i].loud) n++;
    }
    return n;
  }

  private maybeVerify(): void {
    if (!this.verify || this.inFlight || this.entries.length < FIRST_VERIFY) return;
    // Back off when the sound keeps turning out not to be the owner (TV, radio, a crowd)
    const every = this.failures >= 6 ? 50 : this.failures >= 3 ? 30 : 15;
    if (this.idx - this.lastVerify < every) return;

    const size = Math.min(WINDOW, this.entries.length);
    const window = this.entries.slice(this.entries.length - size);
    if (window.filter((e) => e.loud).length / size < MIN_WINDOW_LOUD) return;

    const windowStart = this.idx - size + 1;
    const windowEnd = this.idx;
    const epoch = this.epoch;
    const bargeIn = this.mode === "speaking";
    this.inFlight = true;
    this.lastVerify = this.idx;
    this.verify(concatFrames(window.map((e) => e.frame)), bargeIn).then(
      (verdict) => this.onVerdict(verdict, epoch, bargeIn, windowStart, windowEnd),
      () => this.onVerdict(null, epoch, bargeIn, windowStart, windowEnd)
    );
  }

  private onVerdict(verdict: GateVerdict | null, epoch: number, bargeIn: boolean, windowStart: number, windowEnd: number): void {
    if (epoch !== this.epoch) return;
    this.inFlight = false;
    this.events.onVerdict?.(verdict, bargeIn);

    if (!verdict) {
      this.failures++;
      if (++this.verifierFailures === 3) this.events.onVerifierTrouble?.();
    } else {
      this.verifierFailures = 0;
      if (verdict.match) {
        this.failures = 0;
        this.matches++;
        this.lastMatchEnd = windowEnd;
        if (this.firstMatchStart < 0) this.firstMatchStart = windowStart;
        // Interrupting VECTOR takes two matching checks in a row; a single one can be a fluke
        if (this.phase === "candidate" && this.matches >= (bargeIn ? 2 : 1)) {
          this.phase = "active";
          this.events.onOwnerSpeech();
        }
      } else {
        this.failures++;
        this.matches = 0;
        if (this.firstMatchStart < 0) this.rejectedBeforeMatch = true;
      }
    }

    if (this.pendingDecision) {
      this.pendingDecision = false;
      void this.decideCandidate();
    }
  }

  private finish(endFrame: number): void {
    const end = Math.max(1, Math.min(this.entries.length, endFrame - this.segStart + 1));
    // If the room was already talking before the owner joined, drop that lead-in
    const start =
      this.rejectedBeforeMatch && this.firstMatchStart >= 0
        ? Math.min(end - 1, Math.max(0, this.firstMatchStart - this.segStart - LEAD_TRIM))
        : 0;
    const kept = this.entries.slice(start, end);
    const loudKept = kept.filter((e) => e.loud).length;
    this.resetState();
    if (loudKept >= MIN_LOUD) {
      this.mode = "off"; // one turn at a time: the caller re-arms when it is ready to listen again
      this.events.onUtterance(concatFrames(kept.map((e) => e.frame)));
    }
  }

  /** Forget any sound in progress (the room-noise floor is kept). */
  resetState(): void {
    this.epoch++;
    this.phase = "idle";
    this.preRoll = [];
    this.entries = [];
    this.loudRun = 0;
    this.loudFrames = 0;
    this.inFlight = false;
    this.pendingDecision = false;
    this.lastVerify = -Infinity;
    this.failures = 0;
    this.matches = 0;
    this.lastMatchEnd = -1;
    this.firstMatchStart = -1;
    this.rejectedBeforeMatch = false;
  }
}
