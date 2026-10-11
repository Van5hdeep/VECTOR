import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ToolError } from "./types.js";

// ─── Allowed Roots ───────────────────────────────────────────
// File tools may only touch these folders. Override with VECTOR_FILE_ROOTS
// (semicolon-separated absolute paths).

export interface FileRoot {
  name: string;
  path: string; // real path
}

function detectKnownFolders(): string[] {
  const home = os.homedir();
  let desktop = path.join(home, "Desktop");
  let documents = path.join(home, "Documents");
  if (process.platform === "win32") {
    try {
      // Desktop/Documents are often redirected (OneDrive, custom locations)
      const [d, docs] = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('MyDocuments')"],
        { encoding: "utf8", timeout: 10_000 }
      ).split(/\r?\n/).map((s) => s.trim());
      if (d) desktop = d;
      if (docs) documents = docs;
    } catch {
      // fall back to defaults
    }
  }
  return [documents, desktop, path.join(home, "Downloads")];
}

function loadRoots(): FileRoot[] {
  const configured = process.env.VECTOR_FILE_ROOTS?.split(";").map((p) => p.trim()).filter(Boolean);
  const candidates = configured?.length ? configured : detectKnownFolders();
  const roots: FileRoot[] = [];
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync.native(path.resolve(candidate));
      if (fs.statSync(real).isDirectory() && !roots.some((r) => r.path === real)) {
        roots.push({ name: path.basename(real), path: real });
      }
    } catch {
      // missing folder: skip
    }
  }
  return roots;
}

export const FILE_ROOTS = loadRoots();

export function describeRoots(): string {
  return FILE_ROOTS.map((r) => `${r.name} (${r.path})`).join(", ");
}

// ─── Path Resolution ─────────────────────────────────────────

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Resolves symlinks/junctions on the longest existing prefix of the path. */
function realpathLoose(target: string): string {
  let existing = target;
  const rest: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync.native(existing), ...rest);
}

/**
 * Turns a user/model supplied path into an absolute path guaranteed to sit
 * inside one of the allowed roots. Accepts absolute paths, "Desktop/x.txt"
 * style paths (first segment = root name), or paths relative to Documents.
 */
export function resolveSafePath(input: string): string {
  const cleaned = String(input ?? "").trim().replace(/^["']|["']$/g, "");
  if (!cleaned) throw new ToolError("A path is required.");
  if (FILE_ROOTS.length === 0) throw new ToolError("No file folders are available to VECTOR.");

  let candidate: string;
  if (path.isAbsolute(cleaned)) {
    candidate = path.resolve(cleaned);
  } else {
    const [first, ...rest] = cleaned.split(/[\\/]+/);
    const root = FILE_ROOTS.find((r) => r.name.toLowerCase() === first.toLowerCase());
    candidate = root ? path.resolve(root.path, ...rest) : path.resolve(FILE_ROOTS[0].path, cleaned);
  }

  const real = realpathLoose(candidate);
  if (!FILE_ROOTS.some((r) => isInside(r.path, real))) {
    throw new ToolError(`Access denied: VECTOR may only use these folders: ${describeRoots()}.`);
  }
  return real;
}

/** Path shown back to the model/user, relative to its root where possible. */
export function displayPath(absolute: string): string {
  const root = FILE_ROOTS.find((r) => isInside(r.path, absolute));
  if (!root) return absolute;
  const rel = path.relative(root.path, absolute);
  return rel ? `${root.name}\\${rel}` : root.name;
}

// Files that would execute code if "opened"
const EXECUTABLE_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh",
  ".msi", ".msp", ".scr", ".lnk", ".url", ".hta", ".cpl", ".jar", ".reg", ".pif", ".appref-ms",
]);

export function isExecutable(file: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(path.extname(file).toLowerCase());
}
