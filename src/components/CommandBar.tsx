import { useState, type FormEvent } from "react";

interface CommandBarProps {
  onSubmit?: (query: string) => void;
  disabled?: boolean;
  isConversationMinimized?: boolean;
  minimizedMessagesCount?: number;
  onRestoreConversation?: () => void;
}

const CommandBar = ({ 
  onSubmit, 
  disabled, 
  isConversationMinimized, 
  minimizedMessagesCount = 0, 
  onRestoreConversation 
}: CommandBarProps) => {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim() && !disabled) {
      console.log("[VECTOR Command]:", query);
      onSubmit?.(query);
      setQuery("");
    }
  };

  return (
    <div className="command-section">
      <form className="command-bar" onSubmit={handleSubmit}>
        {isConversationMinimized ? (
          <button 
            type="button" 
            className="command-bar__minimized-conv" 
            onClick={onRestoreConversation}
          >
            <span className="command-bar__minimized-title">VECTOR</span>
            <span className="command-bar__minimized-count">
              {minimizedMessagesCount}
            </span>
          </button>
        ) : (
          <span className="command-bar__search-icon">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <line x1="13" y1="13" x2="18" y2="18" strokeLinecap="round" />
            </svg>
          </span>
        )}
        <input
          className="command-bar__input"
          type="text"
          placeholder="Search anything or ask VECTOR..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
        />
        <button
          className="command-bar__send"
          type="submit"
          aria-label="Send command"
          disabled={disabled}
          style={{ opacity: disabled ? 0.4 : 1 }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M2.5 10L17.5 10M17.5 10L12 4.5M17.5 10L12 15.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </div>
  );
};

export default CommandBar;
