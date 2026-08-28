import { useState, useCallback, useRef, useEffect } from "react";
import { synthesizeSpeech } from "../api/tts";

export interface UseVoiceProps {
  onRecordingComplete?: (audioBlob: Blob) => void;
}

export interface UseVoiceReturn {
  /** Whether voice mode is toggled on */
  voiceActive: boolean;
  /** Whether TTS audio is currently playing */
  isSpeaking: boolean;
  /** Whether TTS is being fetched from the server */
  isProcessing: boolean;
  /** Audio amplitude 0–1, driven by Web Audio API analysis */
  amplitude: number;
  /** Whether microphone is active */
  isListening: boolean;
  /** Toggle voice mode on/off/interrupt */
  toggleVoice: () => void;
  /** Send text to ElevenLabs TTS and play the result */
  speak: (text: string) => void;
  /** Update processing state */
  setProcessing: (processing: boolean) => void;
  /** Reset voice state */
  resetVoice: () => void;
}

export function useVoice(props?: UseVoiceProps): UseVoiceReturn {
  const [voiceActive, setVoiceActiveState] = useState(false);
  const [isListening, setIsListeningState] = useState(false);
  const [isSpeaking, setIsSpeakingState] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [amplitude, setAmplitude] = useState(0);

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

  const setVoiceActive = useCallback((val: boolean) => {
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

  // Recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  
  // Silence detection refs
  const lastSpeechTimeRef = useRef<number>(0);
  const hasSpokenInSessionRef = useRef<boolean>(false);
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

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setListening(false);
  }, [setListening]);

  const destroyStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (micSourceRef.current) {
      try { micSourceRef.current.disconnect(); } catch { /* ignore */ }
      micSourceRef.current = null;
    }
  }, []);

  const cleanupRecording = useCallback(() => {
    stopRecording();
    destroyStream();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setAmplitude(0);
  }, [stopRecording, destroyStream]);

  const startRecordingSession = useCallback(() => {
    if (!streamRef.current) return;
    
    // Stop any existing recorder just in case
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
    }

    const supportedTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "video/webm",
      "video/mp4"
    ];
    let selectedMime = "";
    for (const t of supportedTypes) {
      if (MediaRecorder.isTypeSupported(t)) {
        selectedMime = t;
        break;
      }
    }

    const mediaRecorder = new MediaRecorder(streamRef.current, selectedMime ? { mimeType: selectedMime } : undefined);
    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      setIsProcessing(true);
      setListening(false);
      const mime = mediaRecorder.mimeType || selectedMime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mime });
      propsRef.current?.onRecordingComplete?.(blob);
    };

    lastSpeechTimeRef.current = Date.now();
    hasSpokenInSessionRef.current = false; // Reset spoken flag for the new recording session
    mediaRecorder.start();
    setListening(true);
  }, [setListening]);

  // Keep references to callbacks for the animation loop
  const callbacksRef = useRef({
    cleanupPlayback,
    startRecordingSession,
    stopRecording,
    cleanupRecording,
    setVoiceActive
  });

  useEffect(() => {
    callbacksRef.current = { cleanupPlayback, startRecordingSession, stopRecording, cleanupRecording, setVoiceActive };
  }, [cleanupPlayback, startRecordingSession, stopRecording, cleanupRecording, setVoiceActive]);

  // Animation loop: read audio amplitude from the AnalyserNodes and handle silence/interruption
  const updateAmplitude = useCallback(() => {
    let micRms = 0;
    if (micAnalyserRef.current) {
      const data = new Uint8Array(micAnalyserRef.current.fftSize);
      micAnalyserRef.current.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const sample = (data[i] - 128) / 128;
        sum += sample * sample;
      }
      micRms = Math.sqrt(sum / data.length);
    }

    let playbackRms = 0;
    if (isSpeakingRef.current && playbackAnalyserRef.current) {
      const data = new Uint8Array(playbackAnalyserRef.current.fftSize);
      playbackAnalyserRef.current.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const sample = (data[i] - 128) / 128;
        sum += sample * sample;
      }
      playbackRms = Math.sqrt(sum / data.length);
    }

    // Visual amplitude for the Core (use playback if speaking, otherwise mic)
    const activeRms = isSpeakingRef.current ? playbackRms : micRms;
    const scaled = Math.min(activeRms * 3.5, 1);
    setAmplitude(scaled);

    const now = Date.now();
    
    // Threshold for detecting speech from MIC
    if (micRms > 0.015) {
      lastSpeechTimeRef.current = now;
      hasSpokenInSessionRef.current = true;

      // Interruption detection
      if (isSpeakingRef.current) {
        console.log("[VECTOR] Interruption detected. Cancelling TTS.");
        callbacksRef.current.cleanupPlayback();
        
        // Start a new recording if we aren't currently recording
        if (!isListeningRef.current) {
            callbacksRef.current.startRecordingSession();
        }
      }
    } else {
      // Check for silence timeout if we are currently listening
      if (isListeningRef.current && hasSpokenInSessionRef.current && (now - lastSpeechTimeRef.current > 2000)) {
        console.log("[VECTOR] 2 seconds of silence detected. Stopping recording.");
        callbacksRef.current.stopRecording();
      }
    }

    rafRef.current = requestAnimationFrame(updateAmplitude);
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;

    console.log("[VECTOR_TTS] TTS request started");

    // Stop any currently playing audio
    cleanupPlayback();

    setIsProcessing(true);

    try {
      const audioBuffer = await synthesizeSpeech(text);

      const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;

      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      const audio = audioRef.current;
      audio.src = url;

      const ctx = getAudioContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      if (!playbackAnalyserRef.current) {
        playbackAnalyserRef.current = ctx.createAnalyser();
        playbackAnalyserRef.current.fftSize = 256;
        playbackAnalyserRef.current.smoothingTimeConstant = 0.7;
      }
      
      // Ensure playback analyser is connected to destination for audible output.
      try { playbackAnalyserRef.current.disconnect(); } catch { /* not connected */ }
      playbackAnalyserRef.current.connect(ctx.destination);

      if (!audioSourceRef.current) {
        audioSourceRef.current = ctx.createMediaElementSource(audio);
      }
      
      try { audioSourceRef.current.disconnect(); } catch {}
      audioSourceRef.current.connect(playbackAnalyserRef.current);
      
      console.log("[VECTOR_AUDIO] Audio source created and connected");

      audio.onended = () => {
        console.log("[VECTOR_AUDIO] Playback ended completely.");
        callbacksRef.current.cleanupPlayback();
        // Return to listening state instead of shutting down
        if (!isListeningRef.current) {
          callbacksRef.current.startRecordingSession();
        }
      };
      
      audio.onerror = () => {
        console.error("[VECTOR] Audio playback error");
        callbacksRef.current.cleanupPlayback();
        if (!isListeningRef.current) {
          callbacksRef.current.startRecordingSession();
        }
      };

      setIsProcessing(false);
      setSpeaking(true);

      console.log("[VECTOR_AUDIO] Playback started");
      await audio.play();

    } catch (err) {
      console.error("[VECTOR] TTS error:", (err as Error).message);
      setIsProcessing(false);
      cleanupPlayback();
      cleanupRecording();
      setVoiceActive(false);
    }
  }, [cleanupPlayback, cleanupRecording, getAudioContext, setSpeaking, setVoiceActive]);

  const toggleVoice = useCallback(async () => {
    if (voiceActive) {
      // Manual Cancel / Turn Off
      cleanupPlayback();
      cleanupRecording();
      setIsProcessing(false);
      setVoiceActive(false);
      return;
    }

    // Turn ON Voice Mode
    cleanupPlayback();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }, 
        video: false 
      });
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

      setVoiceActive(true);
      startRecordingSession();
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(updateAmplitude);
      }
    } catch (err) {
      console.error("[VECTOR] Microphone permission denied or error:", err);
      cleanupRecording();
      setVoiceActive(false);
    }
  }, [voiceActive, cleanupPlayback, cleanupRecording, getAudioContext, startRecordingSession, updateAmplitude, setVoiceActive]);

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

  return {
    voiceActive,
    isListening,
    isSpeaking,
    isProcessing,
    amplitude,
    toggleVoice,
    speak,
    setProcessing,
    resetVoice,
  };
}
