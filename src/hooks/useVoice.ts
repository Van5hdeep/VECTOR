import { useState, useCallback, useRef, useEffect } from "react";
import { synthesizeSpeech, audioMime, applySpeechRate } from "../api/tts";
import { getVoiceprintStatus, verifyVoice } from "../api/voiceprint";
import { MIC_CONSTRAINTS, encodeWav, tapPcm } from "../lib/micCapture";
import { SpeechGate, type GateVerifier } from "../lib/speechGate";

export interface UseVoiceProps {
  /** The owner finished a turn: a WAV of their speech only (background trimmed off). */
  onRecordingComplete?: (audioBlob: Blob) => void;
  /** The voiceprint check keeps failing, so VECTOR cannot tell who is talking. */
  onVoiceCheckTrouble?: () => void;
}

export interface UseVoiceReturn {
  /** Whether voice mode is toggled on */
  voiceActive: boolean;
  /** Whether TTS audio is currently playing */
  isSpeaking: boolean;
  /** Whether TTS is being fetched from the server */
  isProcessing: boolean;
  /** Audio level 0–1 (mic while listening, playback while speaking). A ref: read it per frame, it never re-renders. */
  levelRef: React.RefObject<number>;
  /** Whether microphone is active */
  isListening: boolean;
  /** Whether VECTOR only reacts to the owner's voice (a voiceprint is set up) */
  speakerLock: boolean;
  /** Toggle voice mode on/off/interrupt */
  toggleVoice: () => void;
  /** Speak text in VECTOR's voice, sentence by sentence */
  speak: (text: string) => void;
  /** Update processing state */
  setProcessing: (processing: boolean) => void;
  /** Reset voice state */
  resetVoice: () => void;
  /** Nothing to say after a turn (empty transcript, error): go back to listening */
  resumeListening: () => void;
}

/** Speech chunks: a short first sentence for a fast start, then ~2 sentences per chunk. */
function splitForSpeech(text: string): string[] {
  const clean = text.replace(/```[\s\S]*?```/g, " I've put the code on screen. ").replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) ?? [clean];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const limit = chunks.length === 0 ? 1 : 200; // first chunk: one sentence
    if (current && (current.length + sentence.length > limit)) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function useVoice(props?: UseVoiceProps): UseVoiceReturn {
  const [voiceActive, setVoiceActiveState] = useState(false);
  const [isListening, setIsListeningState] = useState(false);
  const [isSpeaking, setIsSpeakingState] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [speakerLock, setSpeakerLock] = useState(false);
  const levelRef = useRef(0);

  // Sync state to refs for animation loop
  const isListeningRef = useRef(false);
  const isSpeakingRef = useRef(false);

  const setListening = useCallback((val: boolean) => {
    isListeningRef.current = val;
    setIsListeningState(val);
  }, []);

  const setSpeaking = useCallback((val: boolean) => {
    isSpeakingRef.current = val;
    setIsSpeakingState(val);
  }, []);

  const voiceActiveRef = useRef(false);
  const setVoiceActive = useCallback((val: boolean) => {
    voiceActiveRef.current = val;
    setVoiceActiveState(val);
  }, []);

  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Split analysers: one for mic (never connected to destination), one for TTS playback
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const objectUrlRef = useRef<string>("");
  // Each speak() call gets a token; cleanupPlayback() bumps it to cancel a sentence queue in flight
  const speakTokenRef = useRef(0);

  // Microphone: the stream, and the tap that feeds 16 kHz audio to the speech gate
  const streamRef = useRef<MediaStream | null>(null);
  const stopTapRef = useRef<(() => void) | null>(null);
  const propsRef = useRef(props);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  // Ensure AudioContext is lazily created and reused
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  const cleanupPlayback = useCallback(() => {
    speakTokenRef.current += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    if (audioSourceRef.current) {
      try { audioSourceRef.current.disconnect(); } catch { /* already disconnected */ }
      // Do not null out audioSourceRef, as it is tied to the persisted audioRef element
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
    setSpeaking(false);
  }, [setSpeaking]);

  const destroyStream = useCallback(() => {
    stopTapRef.current?.();
    stopTapRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (micSourceRef.current) {
      try { micSourceRef.current.disconnect(); } catch { /* ignore */ }
      micSourceRef.current = null;
    }
  }, []);

  // ─── Speech gate: only the owner's voice starts, ends or interrupts a turn ───

  const [gate] = useState(
    () =>
      new SpeechGate(
        {
          onOwnerSpeech: () => {
            // The owner's voice, not the room's: cut VECTOR off if he is talking
            if (isSpeakingRef.current) {
              console.log("[VECTOR] Owner interrupted. Cancelling TTS.");
              callbacksRef.current.cleanupPlayback();
            }
            callbacksRef.current.arm();
          },
          // The gate switches itself off after a turn; resumeListening()/speak() re-arm it
          onUtterance: (pcm) => {
            setIsProcessing(true);
            setListening(false);
            propsRef.current?.onRecordingComplete?.(encodeWav(pcm));
          },
          onVerifierTrouble: () => {
            console.warn("[VECTOR] Voice check is not responding; cannot tell whose voice this is.");
            propsRef.current?.onVoiceCheckTrouble?.();
          },
        },
        null
      )
  );


  /** Ready to hear the owner: the next confirmed speech opens a turn. */
  const arm = useCallback(() => {
    gate.setMode("listening");
    setListening(true);
  }, [gate, setListening]);

  const cleanupRecording = useCallback(() => {
    gate.setMode("off");
    setListening(false);
    destroyStream();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    levelRef.current = 0;
  }, [gate, setListening, destroyStream]);

  // Keep references to callbacks for the audio callbacks
  const callbacksRef = useRef({ cleanupPlayback, arm });

  useEffect(() => {
    callbacksRef.current = { cleanupPlayback, arm };
  }, [cleanupPlayback, arm]);

  const verifier = useCallback<GateVerifier>(async (pcm, bargeIn) => {
    const result = await verifyVoice(pcm, bargeIn);
    if (!result) return null;
    console.debug(`[VECTOR] Voice check ${result.match ? "match" : "no match"}: ${result.score.toFixed(2)} (need ${result.threshold.toFixed(2)})${bargeIn ? " [barge-in]" : ""}`);
    return { match: result.match, score: result.score };
  }, []);

  /** Load the voiceprint state: with one, the gate checks every sound; without, it hears everyone. */
  const refreshVoiceprint = useCallback(async () => {
    let enrolled = false;
    try {
      enrolled = (await getVoiceprintStatus()).enrolled;
    } catch { /* offline or locked: fall back to hearing everyone */ }
    setSpeakerLock(enrolled);
    gate.setVerifier(enrolled ? verifier : null);
  }, [gate, verifier]);

  useEffect(() => {
    const onChanged = () => {
      if (voiceActiveRef.current) void refreshVoiceprint();
    };
    window.addEventListener("vector:voiceprint-changed", onChanged);
    return () => window.removeEventListener("vector:voiceprint-changed", onChanged);
  }, [refreshVoiceprint]);

  // Animation loop: mic/playback level for the Core
  const updateAmplitude = useCallback(() => {
    const rms = (analyser: AnalyserNode | null) => {
      if (!analyser) return 0;
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const sample = (data[i] - 128) / 128;
        sum += sample * sample;
      }
      return Math.sqrt(sum / data.length);
    };

    // The Core follows VECTOR's own voice, or the owner's, never the room
    const active = isSpeakingRef.current
      ? rms(playbackAnalyserRef.current)
      : gate.hearingOwner
        ? rms(micAnalyserRef.current)
        : 0;
    levelRef.current = Math.min(active * 3.5, 1);

    rafRef.current = requestAnimationFrame(updateAmplitude);
  }, [gate]);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    cleanupPlayback();
    const token = ++speakTokenRef.current;
    setIsProcessing(true);

    // Sentence pipeline: the first sentence plays while the rest are still being generated
    const parts = splitForSpeech(text);
    const fetches: Promise<ArrayBuffer>[] = [];
    let previous: Promise<unknown> = Promise.resolve();
    for (const part of parts) {
      const next = previous.then(() => synthesizeSpeech(part));
      fetches.push(next);
      previous = next.catch(() => undefined);
    }

    try {
      const ctx = getAudioContext();
      if (ctx.state === "suspended") await ctx.resume();
      if (!playbackAnalyserRef.current) {
        playbackAnalyserRef.current = ctx.createAnalyser();
        playbackAnalyserRef.current.fftSize = 256;
        playbackAnalyserRef.current.smoothingTimeConstant = 0.7;
      }
      try { playbackAnalyserRef.current.disconnect(); } catch { /* not connected */ }
      playbackAnalyserRef.current.connect(ctx.destination);
      if (!audioRef.current) audioRef.current = new Audio();
      const audio = audioRef.current;
      applySpeechRate(audio);
      if (!audioSourceRef.current) audioSourceRef.current = ctx.createMediaElementSource(audio);
      try { audioSourceRef.current.disconnect(); } catch { /* not connected */ }
      audioSourceRef.current.connect(playbackAnalyserRef.current);

      const playOne = (buffer: ArrayBuffer) =>
        new Promise<void>((resolve, reject) => {
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          const url = URL.createObjectURL(new Blob([buffer], { type: audioMime(buffer) }));
          objectUrlRef.current = url;
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("Audio playback error"));
          audio.src = url;
          audio.play().catch(reject);
        });

      for (let i = 0; i < fetches.length; i++) {
        const buffer = await fetches[i];
        if (speakTokenRef.current !== token) return; // interrupted or replaced
        if (i === 0) {
          setIsProcessing(false);
          setListening(false);
          setSpeaking(true);
          gate.setMode("speaking"); // only the owner's voice may cut in
        }
        await playOne(buffer);
        if (speakTokenRef.current !== token) return;
      }

      // Finished speaking: go back to listening
      callbacksRef.current.cleanupPlayback();
      callbacksRef.current.arm();
    } catch (err) {
      if (speakTokenRef.current !== token) return;
      console.error("[VECTOR] TTS error:", (err as Error).message);
      setIsProcessing(false);
      cleanupPlayback();
      const resume = () => {
        if (speakTokenRef.current === token) callbacksRef.current.arm();
      };
      // Free safety net: the browser's built-in voice, pitched down, if the local voice fails
      if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(parts.join(" "));
        utterance.pitch = 0.5;
        utterance.rate = 0.95;
        utterance.onend = resume;
        utterance.onerror = resume;
        gate.setMode("speaking");
        window.speechSynthesis.speak(utterance);
      } else {
        resume();
      }
    }
  }, [cleanupPlayback, getAudioContext, setSpeaking, setListening, gate]);

  const toggleVoice = useCallback(async () => {
    if (voiceActive) {
      // Manual Cancel / Turn Off
      cleanupPlayback();
      cleanupRecording();
      setIsProcessing(false);
      setVoiceActive(false);
      levelRef.current = 0;
      return;
    }

    // Turn ON Voice Mode
    cleanupPlayback();

    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      streamRef.current = stream;

      const ctx = getAudioContext();
      if (ctx.state === "suspended") await ctx.resume();

      if (micAnalyserRef.current) {
        try { micAnalyserRef.current.disconnect(); } catch {}
      }
      micAnalyserRef.current = ctx.createAnalyser();
      micAnalyserRef.current.fftSize = 256;
      micAnalyserRef.current.smoothingTimeConstant = 0.7;

      micSourceRef.current = ctx.createMediaStreamSource(stream);
      micSourceRef.current.connect(micAnalyserRef.current);
      // Mic analyser is NEVER connected to ctx.destination

      await refreshVoiceprint();
      stopTapRef.current = await tapPcm(ctx, micSourceRef.current, (frame) => gate.push(frame));

      setVoiceActive(true);
      arm();
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(updateAmplitude);
      }
    } catch (err) {
      console.error("[VECTOR] Microphone permission denied or error:", err);
      cleanupRecording();
      setVoiceActive(false);
    }
  }, [voiceActive, cleanupPlayback, cleanupRecording, getAudioContext, arm, gate, refreshVoiceprint, updateAmplitude, setVoiceActive]);

  useEffect(() => {
    return () => {
      cleanupPlayback();
      cleanupRecording();
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
    };
  }, [cleanupPlayback, cleanupRecording]);

  const setProcessing = useCallback((processing: boolean) => {
    setIsProcessing(processing);
  }, []);

  const resetVoice = useCallback(() => {
    cleanupPlayback();
    cleanupRecording();
    setVoiceActive(false);
    setIsProcessing(false);
  }, [cleanupPlayback, cleanupRecording, setVoiceActive]);

  const resumeListening = useCallback(() => {
    setIsProcessing(false);
    if (voiceActiveRef.current) arm();
  }, [arm]);

  return {
    voiceActive,
    isListening,
    speakerLock,
    isSpeaking,
    isProcessing,
    levelRef,
    toggleVoice,
    speak,
    setProcessing,
    resetVoice,
    resumeListening,
  };
}
