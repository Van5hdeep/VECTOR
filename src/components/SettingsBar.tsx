import { useEffect, useState } from "react";

export interface SettingsBarProps {
  isOpen: boolean;
  onClose: () => void;
  activeProvider: string;
  onProviderSelect: (provider: string) => void;
}

interface ProviderUsage {
  used: number;
  limit: number;
  remaining: number;
  unit: string;
}

interface ProviderStatus {
  configured: boolean;
  usage: ProviderUsage | null;
}

interface TTSStatus {
  elevenlabs: ProviderStatus;
  fishAudio: ProviderStatus;
}

export default function SettingsBar({ isOpen, onClose, activeProvider, onProviderSelect }: SettingsBarProps) {
  const [status, setStatus] = useState<TTSStatus | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/tts/status");
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error("Failed to fetch TTS status", e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const renderUsage = (usage: ProviderUsage | null) => {
    if (!usage) return <div className="settings-provider__usage">Usage information unavailable</div>;

    const percentage = usage.limit > 0 ? (usage.used / usage.limit) * 100 : 0;
    
    return (
      <div className="settings-provider__usage-box">
        <div className="settings-provider__usage-text">
          Credits remaining: {usage.remaining.toLocaleString()} {usage.unit}
        </div>
        {usage.limit > 0 && (
          <div className="settings-provider__bar">
            <div className="settings-provider__bar-fill" style={{ width: `${Math.min(100 - percentage, 100)}%` }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="settings-bar-overlay" onClick={onClose}>
      <div className="settings-bar" onClick={(e) => e.stopPropagation()}>
        <div className="settings-bar__header">
          <h2 className="settings-bar__title">VOICE SETTINGS</h2>
          <button className="settings-bar__close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" />
              <line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>

        <div className="settings-bar__content">
          <div className="settings-section">
            <div className="settings-section__title">Choose TTS Engine</div>
            
            <div className="settings-providers">
              {/* ElevenLabs Provider */}
              <div className={`settings-provider ${activeProvider === "elevenlabs" ? "settings-provider--active" : ""}`}>
                <div className="settings-provider__info">
                  <div className="settings-provider__icon settings-provider__icon--elevenlabs" />
                  <div>
                    <div className="settings-provider__name">ElevenLabs</div>
                    <div className="settings-provider__voice">DANIEL</div>
                    <div className="settings-provider__status">
                      <span className={`status-dot ${status?.elevenlabs.configured ? "status-dot--available" : "status-dot--unavailable"}`} />
                      {status?.elevenlabs.configured ? "Available" : "Not configured"}
                    </div>
                  </div>
                </div>
                {status?.elevenlabs.configured && renderUsage(status.elevenlabs.usage)}
                <button 
                  className={`settings-provider__btn ${activeProvider === "elevenlabs" ? "settings-provider__btn--active" : ""}`}
                  onClick={() => onProviderSelect("elevenlabs")}
                >
                  {activeProvider === "elevenlabs" ? "ACTIVE" : "SELECT"}
                </button>
              </div>

              {/* Fish Audio Provider */}
              <div className={`settings-provider ${activeProvider === "fish-audio" ? "settings-provider--active" : ""}`}>
                <div className="settings-provider__info">
                  <div className="settings-provider__icon settings-provider__icon--fishaudio" />
                  <div>
                    <div className="settings-provider__name">Fish Audio</div>
                    <div className="settings-provider__voice">JARVIS</div>
                    <div className="settings-provider__status">
                      <span className={`status-dot ${status?.fishAudio.configured ? "status-dot--available" : "status-dot--unavailable"}`} />
                      {status?.fishAudio.configured ? "Available" : "Not configured"}
                    </div>
                  </div>
                </div>
                {status?.fishAudio.configured && renderUsage(status.fishAudio.usage)}
                <button 
                  className={`settings-provider__btn ${activeProvider === "fish-audio" ? "settings-provider__btn--active" : ""}`}
                  onClick={() => onProviderSelect("fish-audio")}
                >
                  {activeProvider === "fish-audio" ? "ACTIVE" : "SELECT"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
