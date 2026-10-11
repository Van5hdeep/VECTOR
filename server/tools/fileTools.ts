import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolArgs, VectorTool } from "./types.js";
import { ToolError } from "./types.js";
import { FILE_ROOTS, describeRoots, resolveSafePath, displayPath } from "./fsSandbox.js";

const execFileAsync = promisify(execFile);

const MAX_READ_BYTES = 100 * 1024;
const MAX_LIST_ENTRIES = 200;
const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_SCANNED = 30_000;
const SKIP_DIRS = new Set(["node_modules", ".git", "$recycle.bin", "appdata", "__pycache__", ".venv", "venv"]);

function requireExisting(p: string): fs.Stats {
  try {
    return fs.statSync(p);
  } catch {
    throw new ToolError(`Not found: ${displayPath(p)}`);
  }
}

function listDir(dir: string) {
  if (!requireExisting(dir).isDirectory()) throw new ToolError(`${displayPath(dir)} is not a folder.`);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const items = entries.slice(0, MAX_LIST_ENTRIES).map((e) => {
    const full = path.join(dir, e.name);
    let size: number | undefined;
    let modified: string | undefined;
    try {
      const st = fs.statSync(full);
      size = e.isFile() ? st.size : undefined;
      modified = st.mtime.toISOString().slice(0, 16).replace("T", " ");
    } catch {
      // unreadable entry
    }
    return { name: e.name, type: e.isDirectory() ? "folder" : "file", size, modified };
  });
  return { folder: displayPath(dir), total: entries.length, items };
}

function readText(file: string) {
  const st = requireExisting(file);
  if (!st.isFile()) throw new ToolError(`${displayPath(file)} is not a file.`);
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(Math.min(st.size, MAX_READ_BYTES));
    fs.readSync(fd, buf, 0, buf.length, 0);
    if (buf.includes(0)) throw new ToolError("That looks like a binary file; I can only read text files.");
    return {
      file: displayPath(file),
      size: st.size,
      truncated: st.size > MAX_READ_BYTES,
      content: buf.toString("utf8"),
    };
  } finally {
    fs.closeSync(fd);
  }
}

function searchByName(query: string, start?: string) {
  const q = query.toLowerCase().trim();
  if (!q) throw new ToolError("query is required");
  const roots = start ? [resolveSafePath(start)] : FILE_ROOTS.map((r) => r.path);
  const results: { path: string; type: string }[] = [];
  let scanned = 0;

  const walk = (dir: string, depth: number) => {
    if (depth > 8 || results.length >= MAX_SEARCH_RESULTS || scanned >= MAX_SEARCH_SCANNED) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= MAX_SEARCH_RESULTS || scanned >= MAX_SEARCH_SCANNED) return;
      scanned++;
      const full = path.join(dir, e.name);
      if (e.name.toLowerCase().includes(q)) {
        results.push({ path: displayPath(full), type: e.isDirectory() ? "folder" : "file" });
      }
      if (e.isDirectory() && !e.isSymbolicLink() && !SKIP_DIRS.has(e.name.toLowerCase())) {
        walk(full, depth + 1);
      }
    }
  };
  for (const root of roots) walk(root, 0);
  return { query, results, complete: scanned < MAX_SEARCH_SCANNED };
}

/** Sends a file or folder to the Recycle Bin (recoverable), never a hard delete. */
async function recycle(target: string): Promise<void> {
  const isDir = fs.statSync(target).isDirectory();
  const script = [
    "Add-Type -AssemblyName Microsoft.VisualBasic",
    isDir
      ? "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:VECTOR_TARGET, 'OnlyErrorDialogs', 'SendToRecycleBin')"
      : "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:VECTOR_TARGET, 'OnlyErrorDialogs', 'SendToRecycleBin')",
  ].join("; ");
  // Path travels via environment variable so it is never parsed as PowerShell code
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, VECTOR_TARGET: target },
    timeout: 30_000,
  });
}

function confirmationFor(args: ToolArgs): string | null {
  switch (args.action) {
    case "write": {
      const file = resolveSafePath(args.path);
      return fs.existsSync(file) ? `Overwrite ${displayPath(file)}` : null;
    }
    case "move": {
      const from = resolveSafePath(args.path);
      const to = resolveSafePath(args.destination);
      requireExisting(from);
      return `Move ${displayPath(from)} → ${displayPath(to)}`;
    }
    case "delete": {
      const target = resolveSafePath(args.path);
      const st = requireExisting(target);
      return `Move ${st.isDirectory() ? "folder" : "file"} ${displayPath(target)} to the Recycle Bin`;
    }
    default:
      return null;
  }
}

export const fileTools: VectorTool[] = [
  {
    name: "files",
    description: `Work with files in the user's folders: ${describeRoots() || "(none available)"}. Paths may be absolute or start with a folder name, e.g. 'Desktop/todo.txt'. Actions: list, read (text only), search (by file name), write (create/overwrite), append, mkdir, move (also renames), delete (to Recycle Bin).`,
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read", "search", "write", "append", "mkdir", "move", "delete"] },
        path: { type: "string", description: "Target file/folder. For search: optional folder to search in." },
        content: { type: "string", description: "Text for write/append." },
        destination: { type: "string", description: "New path for move." },
        query: { type: "string", description: "Part of the file name, for search." },
      },
      required: ["action"],
    },
    needsConfirmation: confirmationFor,
    run: async (args) => {
      switch (args.action) {
        case "list":
          return listDir(resolveSafePath(args.path || FILE_ROOTS[0]?.path || ""));
        case "read":
          return readText(resolveSafePath(args.path));
        case "search":
          return searchByName(String(args.query ?? ""), args.path);
        case "write":
        case "append": {
          const file = resolveSafePath(args.path);
          if (fs.existsSync(file) && fs.statSync(file).isDirectory()) throw new ToolError(`${displayPath(file)} is a folder.`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const content = String(args.content ?? "");
          if (args.action === "append") fs.appendFileSync(file, content, "utf8");
          else fs.writeFileSync(file, content, "utf8");
          return { message: `${args.action === "append" ? "Appended to" : "Saved"} ${displayPath(file)}.` };
        }
        case "mkdir": {
          const dir = resolveSafePath(args.path);
          fs.mkdirSync(dir, { recursive: true });
          return { message: `Created ${displayPath(dir)}.` };
        }
        case "move": {
          const from = resolveSafePath(args.path);
          const to = resolveSafePath(args.destination);
          requireExisting(from);
          if (fs.existsSync(to)) throw new ToolError(`${displayPath(to)} already exists.`);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.renameSync(from, to);
          return { message: `Moved to ${displayPath(to)}.` };
        }
        case "delete": {
          const target = resolveSafePath(args.path);
          requireExisting(target);
          if (FILE_ROOTS.some((r) => r.path === target)) throw new ToolError("I won't delete one of your root folders.");
          await recycle(target);
          return { message: `${path.basename(target)} is in the Recycle Bin.` };
        }
        default:
          throw new ToolError(`Unknown action: ${args.action}`);
      }
    },
  },
];
