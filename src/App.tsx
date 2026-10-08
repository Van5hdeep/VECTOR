import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage } from "./types/vector";
import type { VectorStatus } from "./types/vector";
import { sendMessage } from "./api/chat";
import { transcribeAudio } from "./api/stt";
import { logout } from "./api/auth";
import { getLatestConversation } from "./api/conversations";
import { getPendingActions, resolvePendingAction, type PendingAction } from "./api/actions";
import { useDraggable } from "./hooks/useDraggable";
import { useVoice } from "./hooks/useVoice";

import { VectorProvider } from "./context/VectorContext";

import HudFrame from "./components/HudFrame";
import VectorHeader from "./components/VectorHeader";
import VectorCore from "./components/VectorCore";
import WeatherCard from "./components/WeatherCard";
import CalendarCard from "./components/CalendarCard";
import TimeCard from "./components/TimeCard";
import SessionCard from "./components/SessionCard";
import CommandBar from "./components/CommandBar";
import ConversationPanel from "./components/ConversationPanel";
import CalendarWorkspace from "./components/CalendarWorkspace";
import LockScreen from "./components/LockScreen";
import SettingsBar from "./components/SettingsBar";

import { useVectorContext } from "./context/VectorContext";

const formatTokens = (value: number): string => {
  if (value >= 1000) {
    return (value / 1000).toFixed(1) + "K";
  }
  return value.toString();
};

function AppContent() {
  // Lock state
  const [lockState, setLockState] = useState<"locked" | "unlocking" | "unlocked">("locked");

  // Conversation state (persisted server-side; null until the first message of a new conversation)
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Sensitive actions VECTOR has proposed, awaiting Sir's approval
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [isConversationOpen, setIsConversationOpen] = useState(false);
  const [isConversationMinimized, setIsConversationMinimized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Telemetry state
  const [sessionTokensUsed, setSessionTokensUsed] = useState(0);
  const [contextTokensUsed, setContextTokensUsed] = useState(0);
  const [contextLimit, setContextLimit] = useState(131072);

  // Calendar state
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarRefreshTrigger, setCalendarRefreshTrigger] = useState(0);

  // Settings & TTS State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTTSProvider, setActiveTTSProvider] = useState(() => {
    return localStorage.getItem("vector_tts_provider") || "elevenlabs";
  });

  const handleProviderSelect = (provider: string) => {
    setActiveTTSProvider(provider);
    localStorage.setItem("vector_tts_provider", provider);
  };

  // Drag hooks
  const weatherDrag = useDraggable();
  const timeDrag = useDraggable();
  const sessionDrag = useDraggable();
  const coreDrag = useDraggable();
  const calendarDrag = useDraggable();
  
  const llmDrag = useDraggable();
  const contextDrag = useDraggable();
  const chatUnitDrag = useDraggable();

  // Voice state
  const voicePropsRef = useRef<{ onRecordingComplete?: (blob: Blob) => void; ttsProvider?: string }>({});
  voicePropsRef.current.ttsProvider = activeTTSProvider;
  
  const voice = useVoice(voicePropsRef.current);
  const interactionIdRef = useRef<number>(0);
  const vectorContext = useVectorContext();

  const handleCommand = useCallback(async (query: string, isVoiceParam?: any) => {
    const isVoice = isVoiceParam === true; // Strictly boolean
    const trimmed = query.trim();
    if (!trimmed) return;
    if (isLoading && !isVoice) return;

    interactionIdRef.current += 1;
    const currentInteractionId = interactionIdRef.current;

    if (!isVoice) {
      // Open the conversation panel if not already open
      if (!isConversationOpen) {
        setIsConversationOpen(true);
      }
      // Restore from minimized if needed
      if (isConversationMinimized) {
        setIsConversationMinimized(false);
      }
    }

    // Add user message and an empty placeholder for the assistant response
    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage, { role: "assistant", content: "" }]);

    // Send to VECTOR_CORE
    setIsLoading(true);
    let currentResponse = "";

    try {
      await sendMessage(trimmed, conversationId, isVoice, (chunk) => {
        if (interactionIdRef.current !== currentInteractionId) return;
        currentResponse += chunk;
        setMessages((prev) => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = { role: "assistant", content: currentResponse };
          return newMessages;
        });
      }, (telemetry) => {
        if (interactionIdRef.current !== currentInteractionId) return;
        setSessionTokensUsed(telemetry.sessionTokensUsed);
        setContextTokensUsed(telemetry.contextTokensUsed);
        setContextLimit(telemetry.contextLimit);
      }, vectorContext, {
        onConversation: (id) => {
          if (interactionIdRef.current !== currentInteractionId) return;
          setConversationId(id);
        },
        onConfirm: (action) => {
          setPendingActions((prev) => [...prev, action]);
        },
        onActionResolved: (actionId) => {
          setPendingActions((prev) => prev.filter((a) => a.id !== actionId));
        },
      });

      // If voice mode is active, send the completed response to ElevenLabs TTS
      if (interactionIdRef.current === currentInteractionId && voice.voiceActive && currentResponse.trim()) {
        voice.speak(currentResponse);
      }
    } finally {
      if (interactionIdRef.current === currentInteractionId) {
        setIsLoading(false);
      }
    }
  }, [isLoading, isConversationOpen, isConversationMinimized, conversationId, voice.voiceActive, voice.speak, vectorContext]);

  voicePropsRef.current.onRecordingComplete = async (audioBlob: Blob) => {
    try {
      const transcript = await transcribeAudio(audioBlob);
      if (transcript.trim()) {
        await handleCommand(transcript, true);
      } else {
        // If STT returned nothing (gibberish/noise), but voice is still active,
        // we shouldn't kill the whole session. We just do nothing and let the user speak again or click to cancel.
        if (!voice.voiceActive) {
          voice.resetVoice();
        }
      }
    } catch (err) {
      console.error("[VECTOR] Voice pipeline error:", err);
      if (!voice.voiceActive) {
        voice.resetVoice();
      }
    }
  };

  const handleMinimize = useCallback(() => {
    setIsConversationMinimized((prev) => !prev);
  }, []);

  // Closing only hides the panel — the conversation itself is remembered.
  const handleCloseConversation = useCallback(() => {
    setIsConversationOpen(false);
    setIsConversationMinimized(false);
  }, []);

  // Start a fresh conversation; the server creates it on the first message.
  const handleNewConversation = useCallback(() => {
    interactionIdRef.current += 1;
    setIsLoading(false);
    setConversationId(null);
    setMessages([]);
    setPendingActions([]);
  }, []);

  // Approve/deny from a confirmation card
  const handleResolveAction = useCallback(async (id: string, approve: boolean) => {
    setPendingActions((prev) => prev.filter((a) => a.id !== id));
    const outcome = await resolvePendingAction(id, approve);
    setMessages((prev) => [...prev, { role: "assistant", content: outcome.message }]);
    if (voice.voiceActive) voice.speak(outcome.message);
  }, [voice]);

  const handleOpenCalendar = useCallback(() => {
    setIsCalendarOpen(true);
  }, []);

  const handleCloseCalendar = useCallback(() => {
    setIsCalendarOpen(false);
  }, []);

  const handleCalendarEventsChanged = useCallback(() => {
    // Trigger a refresh of the dashboard CalendarCard
    setCalendarRefreshTrigger((prev) => prev + 1);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input, textarea, or contentEditable
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      // Don't trigger when locked
      if (lockState !== "unlocked") return;

      if (e.key === "/") {
        e.preventDefault();
        setIsConversationOpen(true);
        setIsConversationMinimized(false);
        
        // Focus the input, using requestAnimationFrame to ensure it happens after state update
        requestAnimationFrame(() => {
          const input = document.querySelector('.command-bar__input') as HTMLInputElement;
          if (input) {
            input.focus();
          }
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lockState]);

  // Compute metrics for compact indicators
  const sessionTokenTarget = 100000;
  const llmPercentage = ((sessionTokensUsed / sessionTokenTarget) * 100).toFixed(1);
  const llmFillWidth = Math.min((sessionTokensUsed / sessionTokenTarget) * 100, 100);
  
  const ctxLimitSafe = contextLimit || 131072;
  const ctxPercentage = Math.round((contextTokensUsed / ctxLimitSafe) * 100);
  const ctxFillWidth = Math.min((contextTokensUsed / ctxLimitSafe) * 100, 100);

  // Derive core status from voice state (internal only — not displayed as text)
  const coreStatus: VectorStatus = voice.voiceActive
    ? voice.isSpeaking
      ? "speaking"
      : voice.isProcessing
        ? "processing"
        : "listening"
    : "standby";

  // Handle core click: toggle voice mode
  const handleCoreClick = useCallback(() => {
    voice.toggleVoice();
  }, [voice]);

  // Session Context is now maintained in App wrapper
  // Lock screen wrapper
  const handleUnlockStart = useCallback(() => {
    setLockState("unlocking");
    window.dispatchEvent(new Event("vector:unlocked"));
    setCalendarRefreshTrigger((prev) => prev + 1);

    // Resume the most recent conversation
    getLatestConversation()
      .then(async ({ conversation, messages: history }) => {
        setConversationId(conversation?.id ?? null);
        setMessages(history);
        setPendingActions(conversation ? await getPendingActions(conversation.id) : []);
      })
      .catch((err) => console.error("[VECTOR] Failed to load conversation history:", err));

    setTimeout(() => {
      setLockState("unlocked");
    }, 1500); // 1.5s for transition
  }, []);

  // A page load always starts locked: revoke any session left over from before.
  useEffect(() => {
    logout();
  }, []);

  // Live server events (reminders). Refs keep the stream from reconnecting on every render.
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    if (lockState !== "unlocked") return;
    const events = new EventSource("/api/events");
    events.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type !== "reminder") return;
        if (event.conversationId === conversationIdRef.current) {
          setMessages((prev) => [...prev, { role: "assistant", content: event.text }]);
          setIsConversationOpen(true);
          setIsConversationMinimized(false);
        }
        if (voiceRef.current.voiceActive) voiceRef.current.speak(event.text);
      } catch {
        // ignore malformed events
      }
    };
    return () => events.close();
  }, [lockState]);

  // Session expired or revoked server-side: return to the lock screen.
  useEffect(() => {
    const handleAuthRequired = () => {
      setLockState("locked");
      setIsConversationOpen(false);
      setIsCalendarOpen(false);
    };
    window.addEventListener("vector:auth-required", handleAuthRequired);
    return () => window.removeEventListener("vector:auth-required", handleAuthRequired);
  }, []);

  return (
    <div className={`app ${lockState !== "unlocked" ? "app--locked" : "app--unlocked"}`}>
      <div className="app__bg" />
      {lockState !== "unlocked" && (
        <LockScreen onUnlock={handleUnlockStart} isUnlocking={lockState === "unlocking"} />
      )}
      
      <HudFrame />

      {/* Title bar */}
      <div className="titlebar">
        <div className="titlebar__left">
          <div className="titlebar__dot" />
          <div className="titlebar__dash" />
          <div className="titlebar__dash" />
        </div>
        <div style={{ flex: 1 }} />
        <div className="titlebar__right">
          <button className="titlebar__btn" aria-label="Settings" onClick={() => setIsSettingsOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 9C8.10457 9 9 8.10457 9 7C9 5.89543 8.10457 5 7 5C5.89543 5 5 5.89543 5 7C5 8.10457 5.89543 9 7 9Z" stroke="currentColor" strokeWidth="1.2" />
              <path d="M12.5 7C12.5 7.6 12.3 8.2 12.1 8.7L13.4 10C13.6 10.2 13.6 10.6 13.4 10.8L12.7 11.5C12.5 11.7 12.1 11.7 11.9 11.5L10.6 10.2C10.1 10.4 9.5 10.6 8.9 10.7L8.7 12.5C8.6 12.8 8.4 13 8.1 13H6.9C6.6 13 6.4 12.8 6.3 12.5L6.1 10.7C5.5 10.6 4.9 10.4 4.4 10.2L3.1 11.5C2.9 11.7 2.5 11.7 2.3 11.5L1.6 10.8C1.4 10.6 1.4 10.2 1.6 10L2.9 8.7C2.7 8.2 2.5 7.6 2.5 7C2.5 6.4 2.7 5.8 2.9 5.3L1.6 4C1.4 3.8 1.4 3.4 1.6 3.2L2.3 2.5C2.5 2.3 2.9 2.3 3.1 2.5L4.4 3.8C4.9 3.6 5.5 3.4 6.1 3.3L6.3 1.5C6.4 1.2 6.6 1 6.9 1H8.1C8.4 1 8.6 1.2 8.7 1.5L8.9 3.3C9.5 3.4 10.1 3.6 10.6 3.8L11.9 2.5C12.1 2.3 12.5 2.3 12.7 2.5L13.4 3.2C13.6 3.4 13.6 3.8 13.4 4L12.1 5.3C12.3 5.8 12.5 6.4 12.5 7Z" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button className="titlebar__btn" aria-label="Minimize">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          <button className="titlebar__btn" aria-label="Maximize">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="2" width="10" height="10" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </button>
          <button className="titlebar__btn titlebar__btn--close" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="3" y1="3" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" />
              <line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Header */}
      <VectorHeader />

      {/* Main content area */}
      <div className="main-content">
        <div className="main-layout">
          {/* Left panel */}
          <div className="side-panel">
            <div {...weatherDrag.dragProps}><WeatherCard /></div>
            <div {...timeDrag.dragProps}><TimeCard /></div>
            <div {...sessionDrag.dragProps}><SessionCard /></div>
          </div>

          {/* Central AI Core */}
          <div {...coreDrag.dragProps} style={{ ...coreDrag.dragProps.style, display: "flex", justifyContent: "center", position: "relative", zIndex: 5 }}>
            <VectorCore
              status={lockState === "locked" ? "locked" : coreStatus}
              onCoreClick={handleCoreClick}
              amplitude={voice.amplitude}
            />
          </div>

          {/* Right panel */}
          <div className="side-panel">
            <div {...calendarDrag.dragProps}>
              <CalendarCard
                onOpenCalendar={handleOpenCalendar}
                refreshTrigger={calendarRefreshTrigger}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Workspace */}
      <CalendarWorkspace
        isOpen={isCalendarOpen}
        onClose={handleCloseCalendar}
        onEventsChanged={handleCalendarEventsChanged}
      />

      {/* Settings Bar */}
      <SettingsBar 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        activeProvider={activeTTSProvider} 
        onProviderSelect={handleProviderSelect} 
      />

      {/* Bottom bar: command bar + compact indicators */}
      <div className="bottom-bar">
        {/* Compact HUD indicators */}
        <div className="hud-indicators">
          <div className="hud-chip" {...llmDrag.dragProps}>
            <span className="hud-chip__label">LLM</span>
            <span className="hud-chip__value">
              {formatTokens(sessionTokensUsed)} / {formatTokens(sessionTokenTarget)}
            </span>
            <div className="hud-chip__bar">
              <div
                className="hud-chip__bar-fill"
                style={{ width: `${llmFillWidth}%` }}
              />
            </div>
            <span className="hud-chip__percent">{llmPercentage}%</span>
          </div>

          <div className="hud-chip" {...contextDrag.dragProps}>
            <span className="hud-chip__label">CONTEXT</span>
            <span className="hud-chip__value">
              {formatTokens(contextTokensUsed)} / {formatTokens(ctxLimitSafe)}
            </span>
            <div className="hud-chip__bar">
              <div
                className="hud-chip__bar-fill"
                style={{ width: `${ctxFillWidth}%` }}
              />
            </div>
            <span className="hud-chip__percent">{ctxPercentage}%</span>
          </div>
        </div>

        {/* Chat Unit: Command bar + docked conversation */}
        <div className="chat-unit" {...chatUnitDrag.dragProps} style={chatUnitDrag.dragProps.style}>
          <ConversationPanel
            messages={messages}
            isOpen={isConversationOpen}
            isMinimized={isConversationMinimized}
            onMinimize={handleMinimize}
            onClose={handleCloseConversation}
            onNewConversation={handleNewConversation}
            pendingActions={pendingActions}
            onResolveAction={handleResolveAction}
          />
          <CommandBar 
            onSubmit={handleCommand} 
            disabled={isLoading}
            isConversationMinimized={isConversationMinimized && isConversationOpen}
            minimizedMessagesCount={messages.length}
            onRestoreConversation={() => setIsConversationMinimized(false)}
          />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <VectorProvider>
      <AppContent />
    </VectorProvider>
  );
}
