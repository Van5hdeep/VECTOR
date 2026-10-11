/**
 * VECTOR's portrait (public/vector-portrait.webp) for the lock screen, in two moods.
 * The source has red eyes and seams; blue is made by rotating the hue of only the
 * glowing red pixels, so one image serves both states.
 */

export type PortraitEyes = "red" | "blue";

export const PORTRAIT_SRC = "/vector-portrait.webp";

// Target hue (degrees) for recoloured glow
const BLUE_HUE = 202;

let imagePromise: Promise<HTMLImageElement> | null = null;
let bluePromise: Promise<string> | null = null;

function loadImage(): Promise<HTMLImageElement> {
  imagePromise ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Portrait failed to load"));
    img.src = PORTRAIT_SRC;
  });
  return imagePromise;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/** Rotate red glow to the target hue; everything else (grey armour) is untouched. */
function recolor(data: Uint8ClampedArray, hue: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const [h, s, v] = rgbToHsv(r, g, b);
    const redness = h > 330 || h < 25 ? 1 : 0;
    if (!redness || s < 0.18 || v < 0.08) continue;
    // Blend by saturation so soft glow edges transition smoothly
    const w = Math.min(1, (s - 0.18) / 0.3);
    const [nr, ng, nb] = hsvToRgb(hue, s, Math.min(1, v * 1.04));
    data[i] = (r + (nr - r) * w) * 255;
    data[i + 1] = (g + (ng - g) * w) * 255;
    data[i + 2] = (b + (nb - b) * w) * 255;
  }
}

function renderBlue(): Promise<string> {
  bluePromise ??= loadImage().then((img) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    recolor(pixels.data, BLUE_HUE);
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/webp", 0.92);
  });
  return bluePromise;
}

/** Full portrait in the given mood. */
export function portrait(eyes: PortraitEyes): Promise<string> {
  return eyes === "red" ? Promise.resolve(PORTRAIT_SRC) : renderBlue();
}
