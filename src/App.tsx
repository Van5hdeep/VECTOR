import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { VectorProvider, useVectorContext } from "./context/VectorContext";
import { useVoice } from "./hooks/useVoice";
import { useChat } from "./hooks/useChat";
import { useLiveEvents, type LiveEvent } from "./hooks/useLiveEvents";
import { transcribeAudio } from "./api/stt";
import { logout } from "./api/auth";
import { playChime, speakWelcome } from "./lib/sound";
import { applyFavicon } from "./lib/reactor";
import type { EngineInputs, OrbMode } from "./engine/particles";

import ParticleField from "./components/ParticleField";
import LockScreen from "./components/lock/LockScreen";
import TopBar from "./components/console/TopBar";
import CommandDock from "./components/console/CommandDock";
import OrbCaption from "./components/console/OrbCaption";
import EnvironmentCard from "./components/cards/EnvironmentCard";
import CalendarCard from "./components/cards/CalendarCard";
import RemindersCard from "./components/cards/RemindersCard";
import SystemCard from "./components/cards/SystemCard";
import SettingsPanel from "./components/SettingsPanel";

// Markdown, KaTeX and the chat UI load only when the workspace first opens
const ChatWorkspace = lazy(() => import("./components/chat/ChatWorkspace"));

type Phase = "locked" | "welcome" | "lights" | "online";

// Welcome sequence timings (ms) — see .planning/03-screens.md §A
const WELCOME_VOICE_AT = 650;
const LIGHTS_AT = 2100;
const ONLINE_AT = 3000;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function AppShell() {
  const vectorContext = useVectorContext();
  const contextRef = useRef(vectorContext);
  contextRef.current = vectorContext;

  const [phase, setPhase] = useState<Phase>("locked");
  const [onlineSince, setOnlineSince] = useState(() => Date.now());
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState({ text: "", version: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remindersVersion, setRemindersVersion] = useState(0);
  const [systemVersion, setSystemVersion] = useState(0);
  const [caption, setCaption] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);

  const chat = useChat(useCallback(() => contextRef.current, []));

  // ─── Voice ─────────────────────────────────────────────────
  const voiceProps = useRef<{ onRecordingComplete?: (blob: Blob) => void; onVoiceCheckTrouble?: () => void }>({});
  const voice = useVoice(voiceProps.current);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  voiceProps.current.onRecordingComplete = async (blob: Blob) => {
    setVoiceBusy(true);
    let spoke = false;
    try {
      const transcript = (await transcribeAudio(blob)).trim();
      if (!transcript) return;
      setCaption(`“${transcript}”`);
      const reply = await chat.send(transcript, { isVoice: true });
      if (reply.trim() && voiceRef.current.voiceActive) {
        setCaption(reply.length > 160 ? `${reply.slice(0, 157)}…` : reply);
        voiceRef.current.speak(reply);
        spoke = true;
      }
    } catch (err) {
      console.error("[VECTOR] Voice pipeline error:", err);
    } finally {
      setVoiceBusy(false);
      // Nothing to say (empty transcript, error): go back to listening for the next turn
      if (!spoke) voiceRef.current.resumeListening();
    }
  };

  voiceProps.current.onVoiceCheckTrouble = () => {
    setCaption("My voice check isn't responding, so I can't tell whose voice I'm hearing.");
  };

  const mode: OrbMode = !voice.voiceActive
    ? "off"
    : voice.isSpeaking
      ? "speaking"
      : voiceBusy || voice.isProcessing
        ? "thinking"
        : voice.isListening
          ? "listening"
          : "idle";

  const toggleVoice = useCallback(() => {
    setCaption("");
    voiceRef.current.toggleVoice();
  }, []);

  // Without a voiceprint VECTOR reacts to any voice: say how to fix that, once per session
  const hintedRef = useRef(false);
  useEffect(() => {
    if (!voice.voiceActive || voice.speakerLock || hintedRef.current) return;
    hintedRef.current = true;
    setCaption("I'll hear any voice for now. Teach me yours in Settings → My voice and I'll ignore everyone else.");
  }, [voice.voiceActive, voice.speakerLock]);

  // ─── Particle engine inputs (read per frame, no re-render) ─
  const levelRef = voice.levelRef;
  const engineInputs = useRef<EngineInputs>({ mode: "off", level: 0, starVisible: false, dimmed: false });
  engineInputs.current = {
    mode: phase === "online" ? mode : "off",
    get level() {
      return levelRef.current ?? 0;
    },
    starVisible: phase === "lights" || phase === "online",
    dimmed: chatOpen || phase === "locked" || phase === "welcome",
  };

  // ─── Lock / unlock ─────────────────────────────────────────
  const goLocked = useCallback(() => {
    voiceRef.current.resetVoice();
    setChatOpen(false);
    setSettingsOpen(false);
    setPhase("locked");
  }, []);

  const lockNow = useCallback(async () => {
    await logout();
    goLocked();
  }, [goLocked]);

  const handleAuthenticated = useCallback(() => {
    setPhase("welcome");
    playChime();
    window.setTimeout(() => void speakWelcome(), WELCOME_VOICE_AT);
    window.setTimeout(() => setPhase("lights"), LIGHTS_AT);
    window.setTimeout(() => {
      setPhase("online");
      setOnlineSince(Date.now());
      setRemindersVersion((v) => v + 1);
      setSystemVersion((v) => v + 1);
      window.dispatchEvent(new Event("vector:unlocked"));
      void chat.resumeLatest();
    }, ONLINE_AT);
  }, [chat]);

  // A page load always starts locked: revoke any session left over from before
  useEffect(() => {
    void logout();
  }, []);

  // Session expired or revoked server-side
  useEffect(() => {
    window.addEventListener("vector:auth-required", goLocked);
    return () => window.removeEventListener("vector:auth-required", goLocked);
  }, [goLocked]);

  // ─── Chat ──────────────────────────────────────────────────
  const openChat = useCallback((text: string) => {
    setDraft((d) => ({ text, version: d.version + 1 }));
    setChatOpen(true);
  }, []);

  const sendFromWorkspace = useCallback(async (text: string) => {
    const reply = await chat.send(text);
    if (reply.trim() && voiceRef.current.voiceActive) voiceRef.current.speak(reply);
  }, [chat]);

  // ─── Live server events ────────────────────────────────────
  const responding = useLiveEvents(phase === "online", (event: LiveEvent) => {
    if (event.type === "reminder") {
      chat.appendReminder(event.conversationId, event.text);
      setRemindersVersion((v) => v + 1);
      if (voiceRef.current.voiceActive) {
        setCaption(event.text);
        voiceRef.current.speak(event.text);
      }
    } else if (event.type === "briefing") {
      // It arrives as its own new conversation: refresh the list, and read it out when voice is on
      void chat.refreshList();
      if (voiceRef.current.voiceActive) {
        setCaption(event.text);
        voiceRef.current.speak(event.text);
      }
    } else if (event.type === "reminders_changed") {
      setRemindersVersion((v) => v + 1);
    } else if (event.type === "conversation_titled") {
      chat.applyTitle(event.id, event.title);
    } else if (event.type === "reconnected") {
      // Catch up on anything pushed while the stream was down
      setRemindersVersion((v) => v + 1);
      setSystemVersion((v) => v + 1);
      void chat.refreshList();
    }
  });

  // Tab icon: the arc reactor, blue while he's up and responding, red when locked or the server is down
  useEffect(() => {
    applyFavicon(phase === "locked" || !responding ? "alert" : "active");
  }, [phase, responding]);

  // ─── Keyboard ──────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "online") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        void lockNow();
        return;
      }
      if (e.key === "Escape") {
        if (settingsOpen) return; // the panel closes itself
        if (chatOpen) setChatOpen(false);
        else if (voiceRef.current.voiceActive) toggleVoice();
        return;
      }
      if (isTyping(e.target) || chatOpen || settingsOpen) return;
      if (e.key === "/") {
        e.preventDefault();
        openChat("");
      } else if (e.key === " ") {
        e.preventDefault();
        toggleVoice();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, chatOpen, settingsOpen, lockNow, openChat, toggleVoice]);

  return (
    <div className={`app app--${phase}`}>
      <ParticleField inputsRef={engineInputs} onStarClick={phase === "online" && !chatOpen ? toggleVoice : undefined} />

      {phase !== "online" && (
        <LockScreen stage={phase === "locked" ? "locked" : phase === "welcome" ? "welcome" : "lights"} onAuthenticated={handleAuthenticated} />
      )}

      {phase === "online" && (
        <div className={`console ${chatOpen ? "console--behind" : ""}`}>
          <TopBar mode={mode} responding={responding} onToggleVoice={toggleVoice} onOpenSettings={() => setSettingsOpen(true)} onLock={() => void lockNow()} />

          <aside className="rail rail--left" aria-label="Today">
            <EnvironmentCard />
            <CalendarCard onConnectionChange={() => setSystemVersion((v) => v + 1)} />
          </aside>

          <aside className="rail rail--right" aria-label="Status">
            <RemindersCard version={remindersVersion} />
            <SystemCard telemetry={chat.telemetry} onlineSince={onlineSince} version={systemVersion} />
          </aside>

          <OrbCaption mode={mode} line={caption} />

          <footer className="console__dock">
            <CommandDock onOpenChat={openChat} onToggleVoice={toggleVoice} voiceOn={voice.voiceActive} />
          </footer>
        </div>
      )}

      {phase === "online" && chatOpen && (
        <Suspense fallback={null}>
          <ChatWorkspace
            chat={chat}
            draft={draft.text}
            draftVersion={draft.version}
            voiceOn={voice.voiceActive}
            onSend={(text) => void sendFromWorkspace(text)}
            onToggleVoice={toggleVoice}
            onClose={() => setChatOpen(false)}
          />
        </Suspense>
      )}

      <SettingsPanel
        open={settingsOpen}
        voiceActive={voice.voiceActive}
        onClose={() => setSettingsOpen(false)}
        onLock={() => void lockNow()}
      />
    </div>
  );
}

export default function App() {
  return (
    <VectorProvider>
      <AppShell />
    </VectorProvider>
  );
}
