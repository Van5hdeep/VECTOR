import ArcReactor from "../ArcReactor";
import Icon from "../ui/Icon";
import type { OrbMode } from "../../engine/particles";

interface TopBarProps {
  mode: OrbMode;
  /** False when the server connection is down */
  responding: boolean;
  onToggleVoice: () => void;
  onOpenSettings: () => void;
  onLock: () => void;
}

const STATUS: Record<OrbMode, string> = {
  off: "Online",
  idle: "Voice ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

export default function TopBar({ mode, responding, onToggleVoice, onOpenSettings, onLock }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <ArcReactor tone={responding ? "active" : "alert"} size={36} className="topbar__mark" />
        <span className="topbar__word">VECTOR</span>
        <span className={`topbar__status topbar__status--${responding ? mode : "offline"}`}>
          <span className="topbar__pulse" />
          {responding ? STATUS[mode] : "Not responding"}
        </span>
      </div>
      <nav className="topbar__actions" aria-label="VECTOR controls">
        <button
          className={`icon-btn ${mode !== "off" ? "icon-btn--active" : ""}`}
          onClick={onToggleVoice}
          aria-pressed={mode !== "off"}
          aria-label={mode === "off" ? "Start voice (Space)" : "Stop voice"}
          title={mode === "off" ? "Start voice (Space)" : "Stop voice (Esc)"}
        >
          <Icon name="mic" />
        </button>
        <button className="icon-btn" onClick={onOpenSettings} aria-label="Settings" title="Settings">
          <Icon name="settings" />
        </button>
        <button className="icon-btn" onClick={onLock} aria-label="Lock VECTOR (Ctrl+L)" title="Lock (Ctrl+L)">
          <Icon name="lock" />
        </button>
      </nav>
    </header>
  );
}
