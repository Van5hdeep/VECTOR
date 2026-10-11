import type { SVGProps } from "react";

// Minimal inline icon set: 24px grid, 1.6px strokes, currentColor.
const PATHS = {
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  send: <path d="M5 12h13M13 6l6 6-6 6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="m13.5 6.5 4 4" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.7-4.4L4 8" /><path d="M4 3v5h5M4 13a8 8 0 0 0 14.7 4.4L20 16" /><path d="M20 21v-5h-5" /></>,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" /><path d="M10 21h4" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  repeat: <><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></>,
  check: <path d="M5 12.5 10 17l9-10" />,
  chat: <path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
  memory: <><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1z" /><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></>,
  pin: <><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" /><circle cx="12" cy="10" r="2.2" /></>,
  drop: <path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z" />,
  wind: <path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7" />,
  fingerprint: <><path d="M12 11v3a8 8 0 0 1-2 5M8 8.5A5 5 0 0 1 17 11v1a12 12 0 0 1-1 5" /><path d="M5 15a10 10 0 0 0 .5-3V11a6.5 6.5 0 0 1 11-4.7M19.5 9.5A7 7 0 0 1 20 12v.5" /></>,
  power: <><path d="M12 3v8" /><path d="M6.4 6.6a8 8 0 1 0 11.2 0" /></>,
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export default function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

// ─── Weather glyphs (WMO codes) ──────────────────────────────

export function WeatherGlyph({ code, size = 40 }: { code: number | null; size?: number }) {
  const c = code ?? -1;
  const sun = (
    <g stroke="#FFC46B">
      <circle cx="24" cy="22" r="7" />
      <path d="M24 9v3M24 32v3M11 22h3M34 22h3M14.8 12.8l2.1 2.1M31.1 29.1l2.1 2.1M14.8 31.2l2.1-2.1M31.1 14.9l2.1-2.1" />
    </g>
  );
  const cloud = <path d="M15 36h19a7 7 0 0 0 .6-14 10 10 0 0 0-19.2 2.6A6 6 0 0 0 15 36z" stroke="#B8C9DC" fill="rgba(8,16,30,0.85)" />;
  const rain = <path d="M18 40l-2 4M25 40l-2 4M32 40l-2 4" stroke="#3FB6FF" />;
  const snow = <path d="M18 41h.01M25 43h.01M32 41h.01" stroke="#E6F0FA" strokeWidth={3} />;
  const bolt = <path d="M25 37l-4 6h5l-3 5" stroke="#FFC46B" />;
  const fog = <path d="M10 30h28M13 35h22M16 40h16" stroke="#7D93AC" />;

  let art;
  if (c === 0 || c === 1) art = sun;
  else if (c === 2) art = <><g transform="translate(-6 -6) scale(0.85)">{sun}</g>{cloud}</>;
  else if (c === 45 || c === 48) art = fog;
  else if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) art = <>{cloud}{rain}</>;
  else if ((c >= 71 && c <= 77) || c === 85 || c === 86) art = <>{cloud}{snow}</>;
  else if (c >= 95) art = <>{cloud}{bolt}</>;
  else art = cloud;

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {art}
    </svg>
  );
}
