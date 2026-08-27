import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types/vector";

interface ConversationPanelProps {
  messages: ChatMessage[];
  isOpen: boolean;
  isMinimized: boolean;
  onMinimize: () => void;
  onClose: () => void;
}

const ConversationPanel = ({
  messages,
  isOpen,
  isMinimized,
  onMinimize,
  onClose,
}: ConversationPanelProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isOpen && !isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isMinimized]);

  if (!isOpen || isMinimized) return null;

  return (
    <div className="conv-panel">
      {/* Header */}
      <div className="conv-panel__header">
        <span className="conv-panel__title">VECTOR</span>
        <div className="conv-panel__controls">
          <button
            className="conv-panel__btn"
            onClick={onMinimize}
            aria-label="Minimize conversation"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line
                x1="2" y1="7" x2="12" y2="7"
                stroke="currentColor" strokeWidth="1.5"
              />
            </svg>
          </button>
          <button
            className="conv-panel__btn conv-panel__btn--close"
            onClick={onClose}
            aria-label="Close conversation"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line
                x1="3" y1="3" x2="11" y2="11"
                stroke="currentColor" strokeWidth="1.5"
              />
              <line
                x1="11" y1="3" x2="3" y2="11"
                stroke="currentColor" strokeWidth="1.5"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Separator */}
      <div className="conv-panel__divider" />

      {/* Messages */}
      <div className="conv-panel__messages">
        {messages.length === 0 && (
          <div className="conv-panel__empty">
            Awaiting input...
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`conv-msg conv-msg--${msg.role === "user" ? "user" : "assistant"}`}
          >
            <span className="conv-msg__sender">
              {msg.role === "user" ? "YOU" : "VECTOR"}
            </span>
            <div className="conv-msg__content">{msg.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default ConversationPanel;
