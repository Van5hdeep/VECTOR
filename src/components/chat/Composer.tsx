import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Icon from "../ui/Icon";

export interface ComposerHandle {
  focus: () => void;
  setDraft: (text: string) => void;
}

interface ComposerProps {
  isStreaming: boolean;
  voiceOn: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onToggleVoice: () => void;
}

const MAX_HEIGHT = 200;

const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { isStreaming, voiceOn, onSend, onStop, onToggleVoice },
  ref
) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => areaRef.current?.focus(),
    setDraft: (draft: string) => setText(draft),
  }));

  // Auto-grow
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const submit = () => {
    if (!text.trim() || isStreaming) return;
    onSend(text);
    setText("");
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={areaRef}
        className="composer__input"
        rows={1}
        placeholder="Message VECTOR"
        aria-label="Message VECTOR"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer__actions">
        {text.length > 2000 && <span className="composer__count num">{text.length.toLocaleString()}</span>}
        <button
          type="button"
          className={`icon-btn ${voiceOn ? "icon-btn--active" : ""}`}
          onClick={onToggleVoice}
          aria-label={voiceOn ? "Stop voice" : "Talk instead"}
          aria-pressed={voiceOn}
        >
          <Icon name="mic" />
        </button>
        {isStreaming ? (
          <button type="button" className="composer__send composer__send--stop" onClick={onStop} aria-label="Stop generating">
            <Icon name="stop" />
          </button>
        ) : (
          <button type="submit" className="composer__send" disabled={!text.trim()} aria-label="Send">
            <Icon name="send" />
          </button>
        )}
      </div>
    </form>
  );
});

export default Composer;
