import { useEffect, useRef } from "react";
import { ParticleEngine, type EngineInputs } from "../engine/particles";

interface ParticleFieldProps {
  /** Read every frame — never triggers a React render */
  inputsRef: React.RefObject<EngineInputs>;
  /** Star clicks (only when the star is visible) */
  onStarClick?: () => void;
}

export default function ParticleField({ inputsRef, onStarClick }: ParticleFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ParticleEngine | null>(null);
  const clickRef = useRef(onStarClick);
  clickRef.current = onStarClick;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Dev only: window.__vectorOrb = { mode: "speaking", level: 0.6 } drives the orb without a microphone
    const read = import.meta.env.DEV
      ? () => {
          const override = (window as unknown as { __vectorOrb?: Partial<EngineInputs> }).__vectorOrb;
          return override ? { ...inputsRef.current, ...override } : inputsRef.current;
        }
      : () => inputsRef.current;
    const engine = new ParticleEngine(canvas, read);
    engineRef.current = engine;
    engine.start();

    const onResize = () => engine.resize();
    const onVisibility = () => (document.hidden ? engine.stop() : engine.start());
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      engine.stop();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [inputsRef]);

  const overStar = (e: React.MouseEvent) =>
    !!inputsRef.current.starVisible && !!engineRef.current?.hitStar(e.clientX, e.clientY);

  return (
    <canvas
      ref={canvasRef}
      className="particle-field"
      aria-hidden="true"
      onPointerMove={(e) => {
        e.currentTarget.style.cursor = overStar(e) ? "pointer" : "default";
      }}
      onClick={(e) => {
        if (overStar(e)) clickRef.current?.();
      }}
    />
  );
}
