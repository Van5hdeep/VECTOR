/**
 * VECTOR's mark: a triangular arc reactor. One drawing serves the top bar and the
 * browser tab icon. Blue while he's responding, red when he isn't.
 */

export type ReactorTone = "active" | "alert";

export const REACTOR_COLOR: Record<ReactorTone, string> = { active: "#3fb6ff", alert: "#ff3b55" };

export const REACTOR_CORE: Record<ReactorTone, string> = { active: "#e6f6ff", alert: "#ffe4e8" };

/** Inner SVG markup for a 64×64 viewBox. `color` is any CSS colour, e.g. `currentColor`. */
export function reactorMarkup(color: string, core = "#e6f6ff"): string {
  return `
    <defs>
      <radialGradient id="reactor-halo" cx="50%" cy="50%" r="50%">
        <stop offset="0.55" stop-color="${color}" stop-opacity="0.35"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="32" cy="32" r="31.5" fill="url(#reactor-halo)"/>
    <circle cx="32" cy="32" r="27" fill="#06101c" stroke="${color}" stroke-width="3"/>
    <circle cx="32" cy="32" r="21" fill="none" stroke="${color}" stroke-width="6" stroke-dasharray="8.7 4.49" opacity="0.85"/>
    <circle cx="32" cy="32" r="14.5" fill="none" stroke="${color}" stroke-width="1.6"/>
    <g class="reactor__heart">
      <path d="M32 45 20.7 25.5h22.6Z" fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"/>
      <circle cx="32" cy="32" r="3.2" fill="${core}"/>
    </g>`;
}

/** The mark as a standalone SVG document (favicon). */
export function reactorSvg(tone: ReactorTone): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${reactorMarkup(REACTOR_COLOR[tone], REACTOR_CORE[tone])}</svg>`;
}

/** Browser tab icon: just the reactor. */
export function applyFavicon(tone: ReactorTone): void {
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${encodeURIComponent(reactorSvg(tone))}`;
}
