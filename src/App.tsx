import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage } from "./types/vector";
import type { VectorStatus } from "./types/vector";
import { sendMessage } from "./api/chat";
import { transcribeAudio } from "./api/stt";
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

  // Conversation state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
  const voicePropsRef = useRef<{ onRecordingComplete?: (blob: Blob) => void }>({});
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
      await sendMessage(trimmed, messages, isVoice, (chunk) => {
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
      }, vectorContext);

      // If voice mode is active, send the completed response to ElevenLabs TTS
      if (interactionIdRef.current === currentInteractionId && voice.voiceActive && currentResponse.trim()) {
        voice.speak(currentResponse);
      }
    } finally {
      if (interactionIdRef.current === currentInteractionId) {
        setIsLoading(false);
      }
    }
  }, [isLoading, isConversationOpen, isConversationMinimized, messages, voice.voiceActive, voice.speak, vectorContext]);

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

  const handleCloseConversation = useCallback(() => {
    setIsConversationOpen(false);
    setIsConversationMinimized(false);
    setMessages([]);
  }, []);

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
    setTimeout(() => {
      setLockState("unlocked");
    }, 1500); // 1.5s for transition
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
