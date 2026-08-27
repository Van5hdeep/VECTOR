import { useState, useEffect, useCallback } from "react";
import type { VectorStatus } from "../types/vector";

interface VoiceIndicatorProps {
  status: VectorStatus;
}

const BAR_COUNT = 40;

const VoiceIndicator = ({ status }: VoiceIndicatorProps) => {
  const isActive = status === "listening" || status === "speaking";
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(2));

  const generateBars = useCallback(() => {
    if (!isActive) return;

    setBars(
      Array.from({ length: BAR_COUNT }, (_, i) => {
        // Create a waveform shape with randomness
        const center = BAR_COUNT / 2;
        const distFromCenter = Math.abs(i - center) / center;
        const baseHeight = status === "speaking" ? 18 : 14;
        const envelope = Math.cos(distFromCenter * Math.PI * 0.5);
        const randomFactor = 0.3 + Math.random() * 0.7;
        return Math.max(2, envelope * baseHeight * randomFactor);
      })
    );
  }, [isActive, status]);

  useEffect(() => {
    if (!isActive) {
      setBars(Array(BAR_COUNT).fill(2));
      return;
    }

    const interval = setInterval(generateBars, 80);
    return () => clearInterval(interval);
  }, [isActive, generateBars]);

  const getLabel = (): string => {
    switch (status) {
      case "listening": return "Listening...";
      case "speaking": return "Speaking...";
      case "thinking": return "Analyzing...";
      case "processing": return "Processing...";
      default: return "";
    }
  };

  const label = getLabel();

  return (
    <div className="voice-section">
      <div className="voice__bars">
        {bars.map((height, i) => (
          <div
            key={i}
            className={`voice__bar ${isActive ? "voice__bar--active" : "voice__bar--inactive"}`}
            style={{ height: `${height}px` }}
          />
        ))}
      </div>
      {label && (
        <div className={`voice__label ${!isActive ? "voice__label--inactive" : ""}`}>
          {label}
        </div>
      )}
    </div>
  );
};

export default VoiceIndicator;
