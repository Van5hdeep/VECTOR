/**
 * VECTOR particle engine — framework-free Canvas 2D.
 *
 * Particles drift through a slow flow field. When voice mode turns on they
 * converge onto a rotating Fibonacci sphere around the central star; the
 * sphere surface ripples with the audio level and its colours follow state:
 *   idle → blue/violet/orange (reference orb), listening → green,
 *   thinking → amber, speaking → blue.
 */

export type OrbMode = "off" | "idle" | "listening" | "thinking" | "speaking";

export interface EngineInputs {
  mode: OrbMode;
  /** Smoothed audio level 0..1 (mic while listening, playback while speaking) */
  level: number;
  /** Show the central star (hidden while locked) */
  starVisible: boolean;
  /** Dim + slow the field (e.g. chat workspace open) */
  dimmed: boolean;
}

type RGB = [number, number, number];

const STATES = ["idle", "listening", "thinking", "speaking"] as const;
type ActiveState = (typeof STATES)[number];

// Three-stop gradients from the sphere's top (0) to bottom (1)
const PALETTES: Record<ActiveState, [RGB, RGB, RGB]> = {
  idle: [[91, 140, 255], [192, 75, 255], [255, 122, 61]],
  listening: [[120, 255, 200], [61, 245, 160], [20, 190, 120]],
  thinking: [[255, 214, 140], [255, 154, 60], [255, 110, 50]],
  speaking: [[150, 220, 255], [63, 182, 255], [40, 100, 255]],
};

const STAR_COLORS: Record<ActiveState | "off", RGB> = {
  off: [210, 235, 255],
  idle: [225, 215, 255],
  listening: [160, 255, 210],
  thinking: [255, 210, 150],
  speaking: [170, 225, 255],
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function gradient(stops: [RGB, RGB, RGB], t: number): RGB {
  const [a, b, c] = stops;
  if (t < 0.5) {
    const k = t * 2;
    return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  }
  const k = (t - 0.5) * 2;
  return [lerp(b[0], c[0], k), lerp(b[1], c[1], k), lerp(b[2], c[2], k)];
}

export class ParticleEngine {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private time = 0;
  private count = 0;
  private reducedMotion: boolean;

  // Particle state (struct-of-arrays for speed)
  private x!: Float32Array; // drift position
  private y!: Float32Array;
  private vx!: Float32Array;
  private vy!: Float32Array;
  private sx!: Float32Array; // unit-sphere target
  private sy!: Float32Array;
  private sz!: Float32Array;
  private form!: Float32Array; // 0 = drifting, 1 = on sphere
  private delay!: Float32Array; // formation stagger
  private size!: Float32Array;
  private seed!: Float32Array;

  // Smoothed globals
  private weights: Record<ActiveState, number> = { idle: 1, listening: 0, thinking: 0, speaking: 0 };
  private level = 0;
  private sphereOn = 0; // eased 0..1 (for star size, rotation speed)
  private dim = 0;
  private starAlpha = 0;
  private rotY = 0;
  private styleCache = new Map<number, string>();

  private canvas: HTMLCanvasElement;
  private inputs: () => EngineInputs;

  constructor(canvas: HTMLCanvasElement, inputs: () => EngineInputs) {
    this.canvas = canvas;
    this.inputs = inputs;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize();
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.step(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const target = Math.round(Math.min(3000, (this.width * this.height) / 480) * (this.reducedMotion ? 0.4 : 1));
    if (target !== this.count) this.allocate(target);
  }

  /** Is (clientX, clientY) on the central star? */
  hitStar(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const dx = clientX - rect.left - this.width / 2;
    const dy = clientY - rect.top - this.height / 2;
    const radius = 30 + this.sphereOn * this.sphereRadius() * 0.9;
    return dx * dx + dy * dy <= radius * radius;
  }

  private sphereRadius(): number {
    return Math.min(this.width, this.height) * 0.2;
  }

  private allocate(n: number): void {
    const old = this.count;
    const keep = (a: Float32Array | undefined, size: number) => {
      const next = new Float32Array(size);
      if (a) next.set(a.subarray(0, Math.min(a.length, size)));
      return next;
    };
    this.x = keep(this.x, n);
    this.y = keep(this.y, n);
    this.vx = keep(this.vx, n);
    this.vy = keep(this.vy, n);
    this.form = keep(this.form, n);
    this.delay = keep(this.delay, n);
    this.size = keep(this.size, n);
    this.seed = keep(this.seed, n);
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.sz = new Float32Array(n);

    // Fibonacci sphere: evenly spread points
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const yy = 1 - (i / Math.max(n - 1, 1)) * 2;
      const r = Math.sqrt(1 - yy * yy);
      const theta = golden * i;
      this.sx[i] = Math.cos(theta) * r;
      this.sy[i] = yy;
      this.sz[i] = Math.sin(theta) * r;
    }
    for (let i = old; i < n; i++) {
      this.x[i] = Math.random() * this.width;
      this.y[i] = Math.random() * this.height;
      this.vx[i] = 0;
      this.vy[i] = 0;
      this.form[i] = 0;
      this.delay[i] = Math.random() * 0.45;
      this.size[i] = 0.5 + Math.random() * 1.1;
      this.seed[i] = Math.random() * 1000;
    }
    this.count = n;
  }

  private rgba(r: number, g: number, b: number, a: number): string {
    // Quantize so canvas style strings can be cached and reused
    const qr = r >> 3, qg = g >> 3, qb = b >> 3, qa = Math.round(clamp01(a) * 20);
    const key = (((qr << 5) | qg) << 5 | qb) * 32 + qa;
    let style = this.styleCache.get(key);
    if (!style) {
      style = `rgba(${qr << 3},${qg << 3},${qb << 3},${qa / 20})`;
      this.styleCache.set(key, style);
    }
    return style;
  }

  private step(dt: number): void {
    const input = this.inputs();
    const motion = this.reducedMotion ? 0.25 : 1;
    this.time += dt;
    const t = this.time;

    // Ease global state
    const active: ActiveState | null = input.mode === "off" ? null : input.mode;
    const sphereTarget = active ? 1 : 0;
    this.sphereOn += (sphereTarget - this.sphereOn) * Math.min(1, dt * 2.2);
    this.level += (input.level - this.level) * Math.min(1, dt * (input.level > this.level ? 14 : 5));
    // While listening, the sphere turns green as the user actually speaks (not just because the mic is open)
    const voiced = clamp01(0.25 + this.level * 5);
    for (const s of STATES) {
      let target = active === s || (!active && s === "idle") ? 1 : 0;
      if (active === "listening") target = s === "listening" ? voiced : s === "idle" ? 1 - voiced : 0;
      this.weights[s] += (target - this.weights[s]) * Math.min(1, dt * 3.2);
    }
    this.dim += ((input.dimmed ? 1 : 0) - this.dim) * Math.min(1, dt * 3);
    this.starAlpha += ((input.starVisible ? 1 : 0) - this.starAlpha) * Math.min(1, dt * 2.5);

    const speedBoost = 1 + this.weights.thinking * 1.6 + this.weights.speaking * 0.4;
    this.rotY += dt * (0.18 + this.level * 0.5) * speedBoost * motion;

    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    const cx = W / 2;
    const cy = H / 2;
    const R = this.sphereRadius();
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    // Rotation (Y spin + fixed tilt)
    const cosY = Math.cos(this.rotY), sinY = Math.sin(this.rotY);
    const tilt = 0.38, cosX = Math.cos(tilt), sinX = Math.sin(tilt);
    const breathe = Math.sin(t * 1.6) * 0.018;
    const amp = 0.025 + this.level * 0.3 + this.weights.thinking * 0.03;
    const fov = 3.2;
    const driftSpeed = (1 - this.dim * 0.7) * motion;
    const fieldAlpha = 1 - this.dim * 0.55;
    const formRate = dt * 0.9;

    for (let i = 0; i < this.count; i++) {
      // ── Drift (flow field) ─────────────────────────
      const angle = (Math.sin(this.x[i] * 0.0021 + t * 0.07) + Math.cos(this.y[i] * 0.0017 - t * 0.05)) * Math.PI
        + Math.sin(this.seed[i] + t * 0.3) * 1.2; // per-particle wobble breaks up convergence lines
      this.vx[i] += (Math.cos(angle) * 9 - this.vx[i]) * dt * 0.6;
      this.vy[i] += (Math.sin(angle) * 9 - this.vy[i]) * dt * 0.6;
      this.x[i] += this.vx[i] * dt * driftSpeed;
      this.y[i] += this.vy[i] * dt * driftSpeed;
      if (this.x[i] < -10) this.x[i] += W + 20; else if (this.x[i] > W + 10) this.x[i] -= W + 20;
      if (this.y[i] < -10) this.y[i] += H + 20; else if (this.y[i] > H + 10) this.y[i] -= H + 20;

      // ── Formation progress with stagger ────────────
      // Particles rest at -delay when off, so larger delays arrive (and leave) later
      const target = active ? 1 + this.delay[i] : -this.delay[i];
      this.form[i] = target > this.form[i]
        ? Math.min(target, this.form[i] + formRate)
        : Math.max(target, this.form[i] - formRate * 1.3);
      const k = easeInOut(clamp01(this.form[i]));

      // ── Sphere position ────────────────────────────
      let px = this.x[i];
      let py = this.y[i];
      let depth = 0.5;
      let rim = 0;
      let shade = 0.5;
      if (k > 0.001) {
        const ux = this.sx[i], uy = this.sy[i], uz = this.sz[i];
        const noise =
          Math.sin(ux * 3.1 + t * 1.7 + this.seed[i] * 0.001) *
          Math.sin(uy * 2.7 - t * 1.3) *
          Math.sin(uz * 3.3 + t * 1.1);
        const radius = 1 + breathe + noise * amp + (Math.sin(this.seed[i] + t * 3) * 0.008);
        // rotate around Y then tilt around X
        const rx = (ux * cosY - uz * sinY) * radius;
        const rz0 = (ux * sinY + uz * cosY) * radius;
        const ry = (uy * cosX - rz0 * sinX) * radius;
        const rz = uy * sinX + rz0 * cosX;
        const persp = fov / (fov + rz);
        const sxp = cx + rx * R * persp;
        const syp = cy + ry * R * persp;
        px = lerp(px, sxp, k);
        py = lerp(py, syp, k);
        depth = clamp01((1 - rz) / 2); // 1 = front
        rim = 1 - Math.abs(rz); // edge of the sphere
        shade = clamp01((ry + 1) / 2); // top → bottom
      }

      // ── Colour ─────────────────────────────────────
      let r = 0, g = 0, b = 0;
      for (const s of STATES) {
        const w = this.weights[s];
        if (w < 0.002) continue;
        const c = gradient(PALETTES[s], shade);
        r += c[0] * w; g += c[1] * w; b += c[2] * w;
      }
      // Drifting particles are pale blue-white
      const driftTint = 1 - k;
      r = lerp(r, 150 + (this.seed[i] % 60), driftTint);
      g = lerp(g, 190 + (this.seed[i] % 40), driftTint);
      b = lerp(b, 255, driftTint);

      const twinkle = 0.65 + 0.35 * Math.sin(t * 1.5 + this.seed[i]);
      const driftAlpha = (0.22 + (this.size[i] - 0.5) * 0.4) * twinkle;
      // Rim light: edge-on particles glow brightest, like the reference orb
      const sphereAlpha = 0.3 + depth * 0.4 + rim * rim * rim * 0.65 + this.level * 0.25;
      const alpha = lerp(driftAlpha, sphereAlpha, k) * fieldAlpha;
      const sz = lerp(this.size[i], this.size[i] * (1 + depth * 1.1 + rim * 0.4), k) * (1 + this.level * k * 0.6);

      ctx.fillStyle = this.rgba(r | 0, g | 0, b | 0, alpha);
      ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz);
    }

    this.drawStar(cx, cy, R);
    ctx.globalCompositeOperation = "source-over";
  }

  private drawStar(cx: number, cy: number, R: number): void {
    if (this.starAlpha < 0.01) return;
    const ctx = this.ctx;
    let r = 0, g = 0, b = 0;
    const offWeight = 1 - this.sphereOn;
    const add = (c: RGB, w: number) => { r += c[0] * w; g += c[1] * w; b += c[2] * w; };
    add(STAR_COLORS.off, offWeight);
    for (const s of STATES) add(STAR_COLORS[s], this.weights[s] * this.sphereOn);

    const pulse = 1 + Math.sin(this.time * (this.reducedMotion ? 0 : 2)) * 0.08 + this.level * 0.9;
    const core = (3.2 + this.sphereOn * 3) * pulse;
    const halo = (26 + this.sphereOn * R * 0.35) * pulse;
    const a = this.starAlpha * (1 - this.dim * 0.4);

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, halo);
    grad.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${0.55 * a})`);
    grad.addColorStop(0.25, `rgba(${r | 0},${g | 0},${b | 0},${0.18 * a})`);
    grad.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, halo, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(255,255,255,${0.95 * a})`;
    ctx.beginPath();
    ctx.arc(cx, cy, core, 0, Math.PI * 2);
    ctx.fill();
  }
}
