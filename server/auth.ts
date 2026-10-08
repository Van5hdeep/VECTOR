import crypto from "node:crypto";
import type express from "express";
import { insertSession, isSessionValid, deleteSession } from "./db.js";

// ─── Session Cookies ─────────────────────────────────────────

const COOKIE_NAME = "vector_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Where the VECTOR UI is served from (override with VECTOR_UI_ORIGIN)
export const UI_ORIGIN = process.env.VECTOR_UI_ORIGIN || "http://localhost:5173";

export const ALLOWED_ORIGINS = new Set([
  UI_ORIGIN,
  UI_ORIGIN.replace("//localhost:", "//127.0.0.1:"),
]);

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function readSessionToken(req: express.Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Issue a new session after successful authentication. */
export function startSession(res: express.Response): void {
  const token = crypto.randomBytes(32).toString("base64url");
  insertSession(hashToken(token), SESSION_TTL_MS);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export function endSession(req: express.Request, res: express.Response): void {
  const token = readSessionToken(req);
  if (token) deleteSession(hashToken(token));
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function isAuthenticated(req: express.Request): boolean {
  const token = readSessionToken(req);
  return !!token && isSessionValid(hashToken(token));
}

// ─── Middleware ──────────────────────────────────────────────

/** Rejects state-changing requests sent from foreign web pages. */
export function requireTrustedOrigin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const origin = req.headers.origin;
  if (req.method !== "GET" && req.method !== "HEAD" && origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: "Origin not permitted." });
    return;
  }
  next();
}

/** Every protected route requires a valid owner session. */
export function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (isAuthenticated(req)) {
    next();
    return;
  }
  res.setHeader("X-Vector-Auth", "required");
  res.status(401).json({ error: "Authentication required." });
}

// ─── Brute-force Throttle ────────────────────────────────────

const MAX_FAILURES = 5;
const LOCKOUT_MS = 60 * 1000;
let failureCount = 0;
let lockedUntil = 0;

/** Returns seconds remaining in lockout, or 0 if attempts are allowed. */
export function lockoutRemaining(): number {
  const remaining = lockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export function recordAuthFailure(): void {
  failureCount += 1;
  if (failureCount >= MAX_FAILURES) {
    lockedUntil = Date.now() + LOCKOUT_MS;
    failureCount = 0;
  }
}

export function recordAuthSuccess(): void {
  failureCount = 0;
  lockedUntil = 0;
}
