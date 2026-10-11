import { useEffect, useState } from "react";
import { getWebAuthnStatus, registerWebAuthn } from "../api/auth";
import Icon from "./ui/Icon";
import VoiceprintSection from "./VoiceprintSection";

interface SettingsPanelProps {
  open: boolean;
  voiceActive: boolean;
  onClose: () => void;
  onLock: () => void;
}

export default function SettingsPanel({ open, voiceActive, onClose, onLock }: SettingsPanelProps) {
  const [hello, setHello] = useState<boolean | null>(null);
  const [helloMsg, setHelloMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    getWebAuthnStatus().then((s) => setHello(s.registered));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const setupHello = async () => {
    setHelloMsg("");
    const result = await registerWebAuthn();
    if (result.success) {
      setHello(true);
      setHelloMsg("Windows Hello is set up. You can use it on the lock screen.");
    } else {
      setHelloMsg(result.error || "Windows Hello setup didn't finish.");
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="settings" role="dialog" aria-label="Settings">
        <header className="settings__head">
          <h2 className="tech">Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings"><Icon name="close" /></button>
        </header>

        <section className="settings__section">
          <h3 className="label">VECTOR's voice</h3>
          <p className="settings__text">Deep android voice (Kokoro "Michael"), generated on this PC. Free, private, no usage limits.</p>
        </section>

        <VoiceprintSection voiceActive={voiceActive} />

        <section className="settings__section">
          <h3 className="label">Windows Hello</h3>
          <p className="settings__text">
            {hello === null ? "Checking…" : hello ? "Set up on this device." : "Unlock with your face, fingerprint or PIN instead of typing your password."}
          </p>
          {hello === false && (
            <button className="btn" onClick={setupHello}><Icon name="fingerprint" size={16} /> Set up Windows Hello</button>
          )}
          {helloMsg && <p className="settings__text">{helloMsg}</p>}
        </section>

        <section className="settings__section">
          <h3 className="label">Session</h3>
          <button className="btn" onClick={onLock}><Icon name="lock" size={16} /> Lock VECTOR</button>
          <p className="settings__text">Shortcuts: <kbd>/</kbd> chat, <kbd>Space</kbd> voice, <kbd>Esc</kbd> back, <kbd>Ctrl</kbd>+<kbd>L</kbd> lock.</p>
        </section>
      </aside>
    </>
  );
}
