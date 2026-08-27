import { useState, useCallback } from "react";
import type { ChatMessage } from "./types/vector";
import { weatherData } from "./data/mockData";
import { sendMessage } from "./api/chat";
import { useDraggable } from "./hooks/useDraggable";

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

const formatTokens = (value: number): string => {
  if (value >= 1000) {
    return (value / 1000).toFixed(1) + "K";
  }
  return value.toString();
};

function App() {
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

  const handleCommand = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed || isLoading) return;

    // Open the conversation panel if not already open
    if (!isConversationOpen) {
      setIsConversationOpen(true);
    }
    // Restore from minimized if needed
    if (isConversationMinimized) {
      setIsConversationMinimized(false);
    }

    // Add user message and an empty placeholder for the assistant response
    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage, { role: "assistant", content: "" }]);

    // Send to VECTOR_CORE
    setIsLoading(true);
    let currentResponse = "";

    try {
      await sendMessage(trimmed, messages, (chunk) => {
        currentResponse += chunk;
        setMessages((prev) => {
          const newMessages = [...prev];
          // Update the last message (the assistant placeholder)
          newMessages[newMessages.length - 1] = { role: "assistant", content: currentResponse };
          return newMessages;
        });
      }, (telemetry) => {
        setSessionTokensUsed(telemetry.sessionTokensUsed);
        setContextTokensUsed(telemetry.contextTokensUsed);
        setContextLimit(telemetry.contextLimit);
      });
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isConversationOpen, isConversationMinimized, messages]);

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

  // Compute metrics for compact indicators
  const sessionTokenTarget = 100000;
  const llmPercentage = ((sessionTokensUsed / sessionTokenTarget) * 100).toFixed(1);
  const llmFillWidth = Math.min((sessionTokensUsed / sessionTokenTarget) * 100, 100);
  
  const ctxLimitSafe = contextLimit || 131072;
  const ctxPercentage = Math.round((contextTokensUsed / ctxLimitSafe) * 100);
  const ctxFillWidth = Math.min((contextTokensUsed / ctxLimitSafe) * 100, 100);

  return (
    <div className="app">
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
            <div {...weatherDrag.dragProps}><WeatherCard data={weatherData} /></div>
            <div {...timeDrag.dragProps}><TimeCard /></div>
            <div {...sessionDrag.dragProps}><SessionCard /></div>
          </div>

          {/* Central AI Core */}
          <div {...coreDrag.dragProps} style={{ ...coreDrag.dragProps.style, display: "flex", justifyContent: "center" }}>
            <VectorCore status="standby" />
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

export default App;
