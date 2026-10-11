import { useCallback, useEffect, useRef, useState } from "react";
import {
  enrollVoiceprint,
  getVoiceprintStatus,
  removeVoiceprint,
  setSensitivity,
  type Sensitivity,
  type VoiceprintStatus,
} from "../api/voiceprint";
import { MIC_CONSTRAINTS, concatFrames, frameRms, tapPcm } from "../lib/micCapture";
import Icon from "./ui/Icon";

const PROMPTS = [
  "VECTOR, what's on my calendar for tomorrow, and do I have anything free in the afternoon?",
  "Remind me to call the bank at four o'clock, and add milk and bread to my shopping list.",
  "Search the web for the latest news about space missions and summarize the three biggest stories.",
  "Turn the volume down a little, and tell me what the weather will be like this weekend.",
  "Open my project notes and read me the last few changes I made before lunch.",
  "Thank you, that's all for now. Let me know if anything urgent comes in.",
];

const TARGET_SECONDS = 18; // seconds of actual speech to collect (a full read of the prompts is ~20)
const MIN_SECONDS = 10; // "Done" unlocks here
const SPEECH_RMS = 0.015;
const FRAME_SECONDS = 0.02;

const SENSITIVITIES: { id: Sensitivity; name: string; meta: string }[] = [
  { id: "relaxed", name: "Relaxed", meta: "Hears you easily. A little more background can slip through." },
  { id: "normal", name: "Normal", meta: "Balanced. Recommended." },
  { id: "strict", name: "Strict", meta: "Only a clear match counts. You may need to speak up or repeat yourself." },
];

type Phase = "idle" | "recording" | "saving";

interface VoiceprintSectionProps {
  /** Voice mode owns the microphone while it is on */
  voiceActive: boolean;
}

export default function VoiceprintSection({ voiceActive }: VoiceprintSectionProps) {
  const [status, setStatus] = useState<VoiceprintStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [spoken, setSpoken] = useState(0);
  const [level, setLevel] = useState(0);
  const [message, setMessage] = useState("");

  const framesRef = useRef<Float32Array[]>([]);
  const spokenRef = useRef(0);
  const closeRef = useRef<(() => void) | null>(null);
  const finishedRef = useRef(false); // frames already queued can still arrive after the target is reached

  useEffect(() => {
    getVoiceprintStatus().then(setStatus, () => setStatus({ enrolled: false, sensitivity: "normal" }));
  }, []);

  const releaseMic = useCallback(() => {
    closeRef.current?.();
    closeRef.current = null;
  }, []);

  useEffect(() => releaseMic, [releaseMic]);

  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    releaseMic();
    setPhase("saving");
    setMessage("");
    try {
      const next = await enrollVoiceprint(concatFrames(framesRef.current));
      setStatus(next);
      setMessage("Done. I'll now only react to your voice.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      framesRef.current = [];
      setPhase("idle");
    }
  }, [releaseMic]);

  const start = useCallback(async () => {
    setMessage("");
    framesRef.current = [];
    spokenRef.current = 0;
    finishedRef.current = false;
    setSpoken(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const detach = await tapPcm(ctx, source, (frame) => {
        framesRef.current.push(frame);
        const rms = frameRms(frame);
        setLevel(Math.min(rms * 6, 1));
        if (rms > SPEECH_RMS) {
          spokenRef.current += FRAME_SECONDS;
          setSpoken(spokenRef.current);
          if (spokenRef.current >= TARGET_SECONDS) void finish();
        }
      });
      closeRef.current = () => {
        detach();
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        setLevel(0);
      };
      setPhase("recording");
    } catch {
      setMessage("I couldn't open the microphone. Check that it's allowed and not in use.");
    }
  }, [finish]);

  const cancel = () => {
    releaseMic();
    framesRef.current = [];
    setPhase("idle");
  };

  const remove = async () => {
    setMessage("");
    try {
      setStatus(await removeVoiceprint());
      setMessage("Voiceprint removed. I'll hear any voice again.");
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const choose = async (sensitivity: Sensitivity) => {
    if (!status || status.sensitivity === sensitivity) return;
    setStatus({ ...status, sensitivity });
    try {
      setStatus(await setSensitivity(sensitivity));
    } catch (err) {
      setMessage((err as Error).message);
      setStatus(status);
    }
  };

  const progress = Math.min(spoken / TARGET_SECONDS, 1);
  const promptIndex = Math.min(Math.floor(progress * PROMPTS.length), PROMPTS.length - 1);

  return (
    <section className="settings__section">
      <h3 className="label">My voice</h3>

      {phase === "idle" && (
        <>
          <p className="settings__text">
            {status === null
              ? "Checking…"
              : status.enrolled
                ? "VECTOR only listens to you and ignores TVs, other people and room noise. Only your voice can interrupt him while he talks."
                : "VECTOR currently reacts to any sound. Teach him your voice and he'll ignore everything else, including when he's talking."}
          </p>
          {voiceActive ? (
            <p className="settings__text">Turn voice mode off to set this up.</p>
          ) : (
            <div className="voiceprint__actions">
              <button className="btn" onClick={() => void start()}>
                <Icon name="mic" size={16} /> {status?.enrolled ? "Record again" : "Set up my voice"}
              </button>
              {status?.enrolled && (
                <button className="btn btn--ghost" onClick={() => void remove()}>
                  <Icon name="trash" size={16} /> Remove
                </button>
              )}
            </div>
          )}
        </>
      )}

      {phase === "recording" && (
        <>
          <p className="settings__text">Read these out loud in your normal voice, at your usual distance from the mic.</p>
          <ol className="voiceprint__prompts">
            {PROMPTS.map((p, i) => (
              <li key={p} className={i === promptIndex ? "voiceprint__prompt voiceprint__prompt--now" : i < promptIndex ? "voiceprint__prompt voiceprint__prompt--done" : "voiceprint__prompt"}>
                {p}
              </li>
            ))}
          </ol>
          <div className="voiceprint__meter" aria-hidden>
            <div className="voiceprint__meter-level" style={{ width: `${level * 100}%` }} />
          </div>
          <div className="voiceprint__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="voiceprint__bar-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="voiceprint__actions">
            <button className="btn btn--primary" onClick={() => void finish()} disabled={spoken < MIN_SECONDS}>
              <Icon name="check" size={16} /> Done
            </button>
            <button className="btn btn--ghost" onClick={cancel}>Cancel</button>
          </div>
        </>
      )}

      {phase === "saving" && <p className="settings__text">Learning your voice… the first time this also downloads a 40 MB model, so it can take a minute.</p>}

      {message && <p className="settings__text">{message}</p>}

      {status?.enrolled && phase === "idle" && (
        <>
          <h3 className="label">How strictly</h3>
          <div className="settings__options">
            {SENSITIVITIES.map((s) => (
              <button
                key={s.id}
                className={`settings__option ${status.sensitivity === s.id ? "settings__option--active" : ""}`}
                onClick={() => void choose(s.id)}
              >
                <span className="settings__option-name">{s.name}</span>
                <span className="settings__option-meta">{s.meta}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
