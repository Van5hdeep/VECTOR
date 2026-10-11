import type { OrbMode } from "../../engine/particles";

interface OrbCaptionProps {
  mode: OrbMode;
  /** Last thing heard or said, faded out after a while */
  line: string;
}

const LABEL: Record<OrbMode, string> = {
  off: "Tap the light to talk",
  idle: "Listening for you",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

export default function OrbCaption({ mode, line }: OrbCaptionProps) {
  return (
    <div className={`orb-caption orb-caption--${mode}`} aria-live="polite">
      <span className="orb-caption__state">{LABEL[mode]}</span>
      {mode !== "off" && line && <span className="orb-caption__line">{line}</span>}
    </div>
  );
}
