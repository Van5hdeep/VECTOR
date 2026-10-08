import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { ChatMessage } from "../types/vector";
import type { PendingAction } from "../api/actions";

interface ConversationPanelProps {
  messages: ChatMessage[];
  isOpen: boolean;
  isMinimized: boolean;
  onMinimize: () => void;
  onClose: () => void;
  onNewConversation: () => void;
  pendingActions: PendingAction[];
  onResolveAction: (id: string, approve: boolean) => void;
}

// Custom code component to handle fenced code blocks with a copy button
const CodeBlock = ({ node, className, children, ...props }: any) => {
  const match = /language-(\w+)/.exec(className || "");
  const [copied, setCopied] = useState(false);
  const codeContent = String(children).replace(/\n$/, "");

  // react-markdown v9 passes `node` which indicates if it's inline or block based on its parent in AST sometimes.
  // We can also just rely on `match` or multiline content.
  const isInline = !match && !String(children).includes("\n");

  const handleCopy = () => {
    navigator.clipboard.writeText(codeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isInline) {
    return (
      <div className="code-block">
        <div className="code-block__header">
          <span className="code-block__language">{match ? match[1] : "text"}</span>
          <button className="code-block__copy" onClick={handleCopy} aria-label="Copy code">
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            )}
          </button>
        </div>
        <pre className="code-block__pre">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      </div>
    );
  }

  return (
    <code className={`inline-code ${className || ""}`} {...props}>
      {children}
    </code>
  );
};

const ConversationPanel = ({
  messages,
  isOpen,
  isMinimized,
  onMinimize,
  onClose,
  onNewConversation,
  pendingActions,
  onResolveAction,
}: ConversationPanelProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isOpen && !isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, pendingActions, isOpen, isMinimized]);

  if (!isOpen || isMinimized) return null;

  return (
    <div className="conv-panel">
      {/* Header */}
      <div className="conv-panel__header">
        <span className="conv-panel__title">VECTOR</span>
        <div className="conv-panel__controls">
          <button
            className="conv-panel__btn"
            onClick={onNewConversation}
            aria-label="New conversation"
            title="New conversation"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" strokeWidth="1.5" />
              <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
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
            <div className="conv-msg__content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  code: CodeBlock,
                  // Strip default pre wrapper to avoid nested pre tags from our custom code block
                  pre: ({ children }) => <>{children}</>
                }}
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}
        {pendingActions.map((action) => (
          <div key={action.id} className="action-card" role="group" aria-label="Action awaiting approval">
            <span className="action-card__label">AWAITING YOUR APPROVAL</span>
            <div className="action-card__summary">{action.summary}</div>
            <div className="action-card__buttons">
              <button className="action-card__btn action-card__btn--approve" onClick={() => onResolveAction(action.id, true)}>
                PROCEED
              </button>
              <button className="action-card__btn" onClick={() => onResolveAction(action.id, false)}>
                CANCEL
              </button>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default ConversationPanel;
