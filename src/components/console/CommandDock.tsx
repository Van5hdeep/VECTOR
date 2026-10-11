import { useState } from "react";
import Icon from "../ui/Icon";

interface CommandDockProps {
  /** Opens the chat workspace, carrying over anything typed */
  onOpenChat: (draft: string) => void;
  onToggleVoice: () => void;
  voiceOn: boolean;
}

/** Quick entry point: typing or clicking opens the full chat workspace. */
export default function CommandDock({ onOpenChat, onToggleVoice, voiceOn }: CommandDockProps) {
  const [draft, setDraft] = useState("");

  const open = (text: string) => {
    onOpenChat(text);
    setDraft("");
  };

  return (
    <div className="dock">
      <Icon name="chat" size={18} className="dock__icon" />
      <input
        className="dock__input"
        placeholder="Ask VECTOR anything…"
        aria-label="Ask VECTOR"
        value={draft}
        onFocus={(e) => { if (!e.currentTarget.value) open(""); }}
        onChange={(e) => open(e.target.value)}
      />
      <kbd className="dock__kbd">/</kbd>
      <button
        className={`icon-btn dock__mic ${voiceOn ? "icon-btn--active" : ""}`}
        onClick={onToggleVoice}
        aria-label={voiceOn ? "Stop voice" : "Talk to VECTOR"}
        aria-pressed={voiceOn}
      >
        <Icon name="mic" />
      </button>
    </div>
  );
}
