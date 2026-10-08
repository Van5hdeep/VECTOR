import fs from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VectorTool } from "./types.js";
import { ToolError } from "./types.js";
import { resolveSafePath, displayPath, isExecutable } from "./fsSandbox.js";

const execFileAsync = promisify(execFile);

/** Hands a target to the Windows shell without any command-line parsing. */
function shellOpen(target: string): void {
  const child = spawn("explorer.exe", [target], { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", (err) => console.error("[VECTOR_TOOLS] Shell open failed:", err.message));
  child.unref();
}

// ─── Installed Apps (Start menu) ─────────────────────────────

interface StartApp {
  Name: string;
  AppID: string;
}

let appCache: { apps: StartApp[]; loadedAt: number } | null = null;
const APP_CACHE_MS = 10 * 60 * 1000;

async function getStartApps(): Promise<StartApp[]> {
  if (appCache && Date.now() - appCache.loadedAt < APP_CACHE_MS) return appCache.apps;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress"],
    { encoding: "utf8", timeout: 20_000, maxBuffer: 10 * 1024 * 1024 }
  );
  const parsed = JSON.parse(stdout || "[]");
  const apps = (Array.isArray(parsed) ? parsed : [parsed]) as StartApp[];
  appCache = { apps, loadedAt: Date.now() };
  return apps;
}

function rankApps(apps: StartApp[], query: string): StartApp[] {
  const q = query.toLowerCase().trim();
  const score = (name: string): number => {
    const n = name.toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.split(/\s+/).some((w) => w.startsWith(q))) return 2;
    if (n.includes(q)) return 3;
    return 99;
  };
  return apps
    .map((app) => ({ app, s: score(app.Name) }))
    .filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s || a.app.Name.length - b.app.Name.length)
    .map((x) => x.app);
}

async function openApp(name: string): Promise<unknown> {
  const matches = rankApps(await getStartApps(), name);
  if (matches.length === 0) {
    throw new ToolError(`No installed app matches "${name}".`);
  }
  const app = matches[0];
  shellOpen(`shell:AppsFolder\\${app.AppID}`);
  return {
    opened: app.Name,
    otherMatches: matches.slice(1, 5).map((a) => a.Name),
  };
}

// ─── URLs ────────────────────────────────────────────────────

// Bare domains are only treated as URLs for common TLDs, so "notes.txt" stays a file.
const BARE_DOMAIN = /^(www\.)?[\w-]+(\.[\w-]+)*\.(com|org|net|io|dev|ai|app|co|in|edu|gov|me|tv|gg|uk|us|info|xyz|tech)(\/\S*)?$/i;

function normaliseUrl(target: string): URL | null {
  const raw = target.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : BARE_DOMAIN.test(raw) ? `https://${raw}` : null;
  if (!withScheme) return null;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

// ─── Tool ────────────────────────────────────────────────────

export const systemTools: VectorTool[] = [
  {
    name: "open",
    description: "Open something on Sir's Windows PC: an installed app by name (e.g. 'Spotify', 'VS Code', 'Calculator'), a website URL, or a file/folder inside Sir's allowed folders.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "App name, URL, or file/folder path." },
        kind: { type: "string", enum: ["auto", "app", "url", "file"], description: "Default auto." },
      },
      required: ["target"],
    },
    run: async (args) => {
      const target = String(args.target ?? "").trim();
      if (!target) throw new ToolError("target is required");
      const kind = args.kind ?? "auto";

      if (kind === "url" || kind === "auto") {
        const url = normaliseUrl(target);
        if (url) {
          shellOpen(url.toString());
          return { opened: url.toString() };
        }
        if (kind === "url") throw new ToolError("Only http(s) URLs can be opened.");
      }

      const looksLikePath = /[\\/]/.test(target) || /\.[a-z0-9]{1,6}$/i.test(target);
      if (kind === "file" || (kind === "auto" && looksLikePath)) {
        const file = resolveSafePath(target);
        if (!fs.existsSync(file)) {
          if (kind === "auto" && !/[\\/]/.test(target)) return openApp(target);
          throw new ToolError(`Not found: ${displayPath(file)}`);
        }
        if (isExecutable(file)) throw new ToolError("Refusing to open an executable or script file. Use an installed app name instead.");
        shellOpen(file);
        return { opened: displayPath(file) };
      }

      return openApp(target);
    },
  },
];
