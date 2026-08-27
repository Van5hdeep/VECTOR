import { useMemo } from "react";
import type { VectorStatus } from "../types/vector";

interface VectorCoreProps {
  status: VectorStatus;
  onCoreClick?: () => void;
}

const VectorCore = ({ status, onCoreClick }: VectorCoreProps) => {
  const isActive = status === "listening" || status === "speaking";

  // Adjust animation speeds based on status
  const speeds = useMemo(() => {
    switch (status) {
      case "listening":
        return { outer: 50, mid: 25, inner: 18, pulse: 2 };
      case "thinking":
      case "processing":
        return { outer: 30, mid: 15, inner: 10, pulse: 1.2 };
      case "speaking":
        return { outer: 40, mid: 20, inner: 14, pulse: 0.8 };
      default:
        return { outer: 60, mid: 35, inner: 25, pulse: 3 };
    }
  }, [status]);

  const glowIntensity = isActive ? 0.45 : status === "standby" ? 0.15 : 0.25;
  const coreGlowIntensity = isActive ? 0.7 : 0.3;

  // Generate tick marks for rings
  const outerTicks = Array.from({ length: 72 }, (_, i) => i * 5);
  const midTicks = Array.from({ length: 36 }, (_, i) => i * 10);

  // Generate particles
  const particles = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => ({
      angle: (i * 360) / 8,
      radius: 120 + (i % 3) * 15,
      delay: i * 0.5,
      size: 1.5 + (i % 2) * 0.5,
    }));
  }, []);

  // Generate waveform segments around the energy core
  const waveSegments = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => {
      const angle = (i * 360) / 24;
      return { angle, index: i };
    });
  }, []);

  return (
    <div className="core-container">
      <div className="core__ambient" />
      <div
        className={`core-wrapper ${isActive ? "core-wrapper--active" : ""}`}
        onClick={onCoreClick}
        role="button"
        tabIndex={0}
        aria-label={isActive ? "Deactivate VECTOR listening" : "Activate VECTOR listening"}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onCoreClick?.();
          }
        }}
      >
        <svg
          className="core-svg"
          viewBox="0 0 400 400"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Glow filter */}
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            <filter id="glow-strong" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            <filter id="glow-intense" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="10" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            {/* Radial gradient for center */}
            <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00C8FF" stopOpacity={glowIntensity} />
              <stop offset="100%" stopColor="#00C8FF" stopOpacity="0" />
            </radialGradient>

            {/* Energy core gradient */}
            <radialGradient id="energyCoreGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity={coreGlowIntensity} />
              <stop offset="25%" stopColor="#5BE7FF" stopOpacity={coreGlowIntensity * 0.8} />
              <stop offset="60%" stopColor="#00C8FF" stopOpacity={coreGlowIntensity * 0.4} />
              <stop offset="100%" stopColor="#00C8FF" stopOpacity="0" />
            </radialGradient>

            {/* Ring gradient */}
            <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00C8FF" stopOpacity={isActive ? "0.9" : "0.6"} />
              <stop offset="50%" stopColor="#18BFFF" stopOpacity={isActive ? "0.5" : "0.3"} />
              <stop offset="100%" stopColor="#5BE7FF" stopOpacity={isActive ? "0.9" : "0.6"} />
            </linearGradient>

            {/* Scan line gradient */}
            <linearGradient id="scanGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00C8FF" stopOpacity="0" />
              <stop offset="50%" stopColor="#00C8FF" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#00C8FF" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Center ambient glow */}
          <circle cx="200" cy="200" r="140" fill="url(#centerGlow)">
            <animate
              attributeName="r"
              values={isActive ? "130;150;130" : "135;145;135"}
              dur={`${speeds.pulse}s`}
              repeatCount="indefinite"
            />
          </circle>

          {/* ═══ OUTER RING — Faint reference circle with ticks ═══ */}
          <g style={{
            animation: `rotateSlow ${speeds.outer}s linear infinite`,
            transformOrigin: 'center',
          }}>
            {/* Main outer circle */}
            <circle
              cx="200" cy="200" r="170"
              fill="none"
              stroke="#00C8FF"
              strokeWidth={isActive ? "0.8" : "0.5"}
              opacity={isActive ? "0.3" : "0.15"}
            />

            {/* Outer tick marks */}
            {outerTicks.map((deg) => {
              const isMajor = deg % 30 === 0;
              const rad = (deg * Math.PI) / 180;
              const r1 = isMajor ? 164 : 167;
              const r2 = 170;
              return (
                <line
                  key={`ot-${deg}`}
                  x1={200 + r1 * Math.cos(rad)}
                  y1={200 + r1 * Math.sin(rad)}
                  x2={200 + r2 * Math.cos(rad)}
                  y2={200 + r2 * Math.sin(rad)}
                  stroke="#00C8FF"
                  strokeWidth={isMajor ? "1" : "0.5"}
                  opacity={isActive ? (isMajor ? "0.5" : "0.2") : (isMajor ? "0.3" : "0.12")}
                />
              );
            })}

            {/* Outer accent arcs */}
            <circle
              cx="200" cy="200" r="175"
              fill="none"
              stroke="#00C8FF"
              strokeWidth="1"
              opacity={isActive ? "0.15" : "0.08"}
              strokeDasharray="20 40"
            />
          </g>

          {/* ═══ SECOND RING — Dashed technical ring ═══ */}
          <g style={{
            animation: `rotateReverse ${speeds.mid}s linear infinite`,
            transformOrigin: 'center',
          }}>
            <circle
              cx="200" cy="200" r="148"
              fill="none"
              stroke="#00C8FF"
              strokeWidth={isActive ? "1.5" : "1"}
              opacity={isActive ? "0.35" : "0.2"}
              strokeDasharray="8 12 3 12"
            />

            {/* Mid tick marks */}
            {midTicks.map((deg) => {
              const rad = (deg * Math.PI) / 180;
              return (
                <line
                  key={`mt-${deg}`}
                  x1={200 + 145 * Math.cos(rad)}
                  y1={200 + 145 * Math.sin(rad)}
                  x2={200 + 151 * Math.cos(rad)}
                  y2={200 + 151 * Math.sin(rad)}
                  stroke="#00C8FF"
                  strokeWidth="0.5"
                  opacity={isActive ? "0.35" : "0.2"}
                />
              );
            })}
          </g>

          {/* ═══ INNER RING — Main glowing ring ═══ */}
          <g style={{
            animation: `rotateSlow ${speeds.inner}s linear infinite`,
            transformOrigin: 'center',
          }}>
            {/* Primary inner ring */}
            <circle
              cx="200" cy="200" r="120"
              fill="none"
              stroke="url(#ringGrad)"
              strokeWidth={isActive ? "2.5" : "2"}
              filter={isActive ? "url(#glow-strong)" : "url(#glow)"}
            >
              <animate
                attributeName="opacity"
                values={isActive ? "0.7;1;0.7" : "0.5;0.8;0.5"}
                dur={`${speeds.pulse}s`}
                repeatCount="indefinite"
              />
            </circle>

            {/* Inner ring accent */}
            <circle
              cx="200" cy="200" r="118"
              fill="none"
              stroke="#00C8FF"
              strokeWidth="0.5"
              opacity={isActive ? "0.3" : "0.15"}
            />

            {/* Dashed inner detail ring */}
            <circle
              cx="200" cy="200" r="125"
              fill="none"
              stroke="#00C8FF"
              strokeWidth="0.75"
              opacity={isActive ? "0.2" : "0.12"}
              strokeDasharray="4 16"
            />
          </g>

          {/* ═══ INNERMOST RING — Bright accent ═══ */}
          <g style={{
            animation: `rotateMedium ${speeds.inner * 0.7}s linear infinite`,
            transformOrigin: 'center',
          }}>
            <circle
              cx="200" cy="200" r="90"
              fill="none"
              stroke="#00C8FF"
              strokeWidth={isActive ? "2" : "1.5"}
              opacity={isActive ? "0.4" : "0.25"}
              strokeDasharray="15 25 8 25"
            />
          </g>

          {/* ═══ ENERGY CORE CENTER ═══ */}
          <g>
            {/* Outer energy ring */}
            <circle
              cx="200" cy="200" r="55"
              fill="none"
              stroke="#00C8FF"
              strokeWidth={isActive ? "1" : "0.5"}
              opacity={isActive ? "0.5" : "0.2"}
            >
              <animate
                attributeName="r"
                values={isActive ? "52;58;52" : "53;57;53"}
                dur={`${speeds.pulse * 1.5}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values={isActive ? "0.3;0.6;0.3" : "0.15;0.3;0.15"}
                dur={`${speeds.pulse * 1.5}s`}
                repeatCount="indefinite"
              />
            </circle>

            {/* Mid energy ring */}
            <circle
              cx="200" cy="200" r="42"
              fill="none"
              stroke="#18BFFF"
              strokeWidth="0.8"
              opacity={isActive ? "0.4" : "0.15"}
              strokeDasharray="6 8"
            >
              <animate
                attributeName="opacity"
                values={isActive ? "0.3;0.5;0.3" : "0.1;0.2;0.1"}
                dur={`${speeds.pulse * 1.2}s`}
                repeatCount="indefinite"
              />
            </circle>

            {/* Inner energy ring */}
            <circle
              cx="200" cy="200" r="30"
              fill="none"
              stroke="#5BE7FF"
              strokeWidth={isActive ? "1.2" : "0.6"}
              opacity={isActive ? "0.5" : "0.2"}
            >
              <animate
                attributeName="r"
                values={isActive ? "28;33;28" : "29;31;29"}
                dur={`${speeds.pulse}s`}
                repeatCount="indefinite"
              />
            </circle>

            {/* Energy core fill — the central glowing point */}
            <circle
              cx="200" cy="200" r="18"
              fill="url(#energyCoreGlow)"
              filter={isActive ? "url(#glow-intense)" : "url(#glow-strong)"}
            >
              <animate
                attributeName="r"
                values={isActive ? "15;22;15" : "17;19;17"}
                dur={`${speeds.pulse}s`}
                repeatCount="indefinite"
              />
            </circle>

            {/* Bright center point */}
            <circle
              cx="200" cy="200" r="6"
              fill="#FFFFFF"
              opacity={isActive ? "0.9" : "0.5"}
              filter="url(#glow)"
            >
              <animate
                attributeName="r"
                values={isActive ? "4;8;4" : "5;7;5"}
                dur={`${speeds.pulse * 0.8}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values={isActive ? "0.7;1;0.7" : "0.35;0.6;0.35"}
                dur={`${speeds.pulse * 0.8}s`}
                repeatCount="indefinite"
              />
            </circle>

            {/* Core glow halo */}
            <circle
              cx="200" cy="200" r="50"
              fill="url(#energyCoreGlow)"
              opacity={isActive ? "0.4" : "0.15"}
            >
              <animate
                attributeName="opacity"
                values={isActive ? "0.25;0.5;0.25" : "0.1;0.2;0.1"}
                dur={`${speeds.pulse * 1.3}s`}
                repeatCount="indefinite"
              />
            </circle>
          </g>

          {/* ═══ WAVEFORM / AUDIO SEGMENTS (visible when active) ═══ */}
          {isActive && (
            <g style={{
              animation: `rotateSlow ${speeds.inner * 0.8}s linear infinite`,
              transformOrigin: 'center',
            }}>
              {waveSegments.map(({ angle, index }) => {
                const rad = (angle * Math.PI) / 180;
                const innerR = 62;
                // Varying heights to simulate waveform
                const heightVariation = [8, 14, 10, 18, 6, 16, 12, 20, 8, 15, 11, 19, 7, 17, 13, 21, 9, 14, 10, 16, 8, 18, 12, 15];
                const outerR = innerR + heightVariation[index];
                return (
                  <line
                    key={`wave-${index}`}
                    x1={200 + innerR * Math.cos(rad)}
                    y1={200 + innerR * Math.sin(rad)}
                    x2={200 + outerR * Math.cos(rad)}
                    y2={200 + outerR * Math.sin(rad)}
                    stroke="#5BE7FF"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    opacity="0.4"
                  >
                    <animate
                      attributeName="opacity"
                      values="0.2;0.6;0.2"
                      dur={`${0.8 + (index % 5) * 0.2}s`}
                      repeatCount="indefinite"
                    />
                  </line>
                );
              })}
            </g>
          )}

          {/* ═══ SCANNING ELEMENTS ═══ */}
          {status !== "standby" && (
            <g style={{
              animation: `rotateFast ${speeds.inner * 0.5}s linear infinite`,
              transformOrigin: 'center',
            }}>
              {/* Scan sweep */}
              <line
                x1="200" y1="200"
                x2="200" y2="60"
                stroke="#00C8FF"
                strokeWidth="1"
                opacity="0.1"
              />
              {/* Scan dot */}
              <circle
                cx="200" cy="80"
                r="2"
                fill="#5BE7FF"
                filter="url(#glow)"
                opacity="0.6"
              />
            </g>
          )}

          {/* ═══ ORBITING PARTICLES ═══ */}
          {particles.map((p, i) => (
            <g
              key={`particle-${i}`}
              style={{
                animation: `rotateSlow ${speeds.outer + p.delay * 5}s linear infinite`,
                transformOrigin: 'center',
              }}
            >
              <circle
                cx={200 + p.radius * Math.cos((p.angle * Math.PI) / 180)}
                cy={200 + p.radius * Math.sin((p.angle * Math.PI) / 180)}
                r={p.size}
                fill="#00C8FF"
                opacity="0.3"
              >
                <animate
                  attributeName="opacity"
                  values="0.1;0.5;0.1"
                  dur={`${2 + p.delay}s`}
                  repeatCount="indefinite"
                />
              </circle>
            </g>
          ))}

          {/* ═══ CROSS HAIRS (subtle) ═══ */}
          <g opacity="0.06">
            <line x1="200" y1="30" x2="200" y2="80" stroke="#00C8FF" strokeWidth="0.5" />
            <line x1="200" y1="320" x2="200" y2="370" stroke="#00C8FF" strokeWidth="0.5" />
            <line x1="30" y1="200" x2="80" y2="200" stroke="#00C8FF" strokeWidth="0.5" />
            <line x1="320" y1="200" x2="370" y2="200" stroke="#00C8FF" strokeWidth="0.5" />
          </g>

          {/* ═══ CARDINAL INDICATORS ═══ */}
          {[0, 90, 180, 270].map((deg) => {
            const rad = (deg * Math.PI) / 180;
            const r = 160;
            return (
              <circle
                key={`cardinal-${deg}`}
                cx={200 + r * Math.cos(rad)}
                cy={200 + r * Math.sin(rad)}
                r="2"
                fill="#00C8FF"
                opacity={isActive ? "0.45" : "0.25"}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
};

export default VectorCore;
