import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Database ────────────────────────────────────────────────
// Single-owner store: VECTOR serves exactly one user, so there is no users table.

const DATA_DIR = process.env.VECTOR_DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export { DATA_DIR };

export const db = new DatabaseSync(path.join(DATA_DIR, "vector.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'New conversation',
    summary TEXT,
    summarized_upto INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);

  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content, content='messages', content_rowid='id'
  );
  CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
  END;

  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Sensitive tool calls wait here until the user approves or denies them
  CREATE TABLE IF NOT EXISTS pending_actions (
    id TEXT PRIMARY KEY,
    conversation_id INTEGER,
    tool TEXT NOT NULL,
    args TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER,
    message TEXT NOT NULL,
    due_at INTEGER NOT NULL,
    repeat TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily', 'weekdays', 'weekly')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fired', 'cancelled')),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_at);

  -- Small server-side flags (e.g. the date the morning briefing last ran)
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// One-time migration: memories were once written as "Sir prefers…"; VECTOR no longer uses titles
db.exec(`
  UPDATE memories SET content = 'The user''s ' || substr(content, 7) WHERE content LIKE 'Sir''s %';
  UPDATE memories SET content = 'The user ' || substr(content, 5) WHERE content LIKE 'Sir %';
`);

// ─── Types ───────────────────────────────────────────────────

export interface ConversationRow {
  id: number;
  title: string;
  summary: string | null;
  summarized_upto: number;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: number;
}

export interface MemoryRow {
  id: number;
  content: string;
  category: string;
  created_at: number;
  updated_at: number;
}

// ─── Auth Sessions ───────────────────────────────────────────

export function insertSession(tokenHash: string, ttlMs: number): void {
  const now = Date.now();
  db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(now);
  db.prepare("INSERT INTO auth_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .run(tokenHash, now, now + ttlMs);
}

export function isSessionValid(tokenHash: string): boolean {
  const row = db.prepare("SELECT expires_at FROM auth_sessions WHERE token_hash = ?")
    .get(tokenHash) as { expires_at: number } | undefined;
  return !!row && row.expires_at > Date.now();
}

export function deleteSession(tokenHash: string): void {
  db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
}

// ─── WebAuthn Credentials ────────────────────────────────────

export interface StoredCredential {
  credentialID: string;
  credentialPublicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports?: string[];
}

export function listWebAuthnCredentials(): StoredCredential[] {
  const rows = db.prepare("SELECT id, public_key, counter, transports FROM webauthn_credentials").all() as {
    id: string; public_key: Uint8Array; counter: number; transports: string | null;
  }[];
  return rows.map((r) => ({
    credentialID: r.id,
    credentialPublicKey: new Uint8Array(r.public_key),
    counter: r.counter,
    transports: r.transports ? JSON.parse(r.transports) : undefined,
  }));
}

export function saveWebAuthnCredential(cred: StoredCredential): void {
  db.prepare("INSERT OR REPLACE INTO webauthn_credentials (id, public_key, counter, transports) VALUES (?, ?, ?, ?)")
    .run(cred.credentialID, cred.credentialPublicKey, cred.counter, cred.transports ? JSON.stringify(cred.transports) : null);
}

export function updateWebAuthnCounter(id: string, counter: number): void {
  db.prepare("UPDATE webauthn_credentials SET counter = ? WHERE id = ?").run(counter, id);
}

// ─── Conversations & Messages ────────────────────────────────

export function createConversation(): ConversationRow {
  const now = Date.now();
  const result = db.prepare("INSERT INTO conversations (created_at, updated_at) VALUES (?, ?)").run(now, now);
  return getConversation(Number(result.lastInsertRowid))!;
}

export function getConversation(id: number): ConversationRow | undefined {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | undefined;
}

export function getLatestConversation(): ConversationRow | undefined {
  return db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 1").get() as ConversationRow | undefined;
}

export function listConversations(limit = 50): ConversationRow[] {
  return db.prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?").all(limit) as unknown as ConversationRow[];
}

export function deleteConversation(id: number): void {
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

export function setConversationTitle(id: number, title: string): void {
  db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, id);
}

export function setConversationSummary(id: number, summary: string, summarizedUpto: number): void {
  db.prepare("UPDATE conversations SET summary = ?, summarized_upto = ? WHERE id = ?").run(summary, summarizedUpto, id);
}

export function addMessage(conversationId: number, role: "user" | "assistant", content: string): MessageRow {
  const now = Date.now();
  const result = db.prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)")
    .run(conversationId, role, content, now);
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
  return { id: Number(result.lastInsertRowid), conversation_id: conversationId, role, content, created_at: now };
}

export function getMessages(conversationId: number): MessageRow[] {
  return db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id").all(conversationId) as unknown as MessageRow[];
}

/** Full-text search across every past conversation. */
export function searchMessages(query: string, limit = 10): (MessageRow & { title: string })[] {
  // Quote each term so user text can't inject FTS5 syntax.
  const ftsQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" OR ");
  if (!ftsQuery) return [];
  return db.prepare(`
    SELECT m.*, c.title FROM messages_fts f
    JOIN messages m ON m.id = f.rowid
    JOIN conversations c ON c.id = m.conversation_id
    WHERE messages_fts MATCH ?
    ORDER BY rank LIMIT ?
  `).all(ftsQuery, limit) as unknown as (MessageRow & { title: string })[];
}

// ─── Long-term Memories ──────────────────────────────────────

export function listMemories(limit = 200): MemoryRow[] {
  return db.prepare("SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?").all(limit) as unknown as MemoryRow[];
}

export function addMemory(content: string, category = "general"): MemoryRow {
  const existing = db.prepare("SELECT * FROM memories WHERE lower(content) = lower(?)").get(content) as MemoryRow | undefined;
  if (existing) return existing;
  const now = Date.now();
  const result = db.prepare("INSERT INTO memories (content, category, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(content, category, now, now);
  return { id: Number(result.lastInsertRowid), content, category, created_at: now, updated_at: now };
}

export function updateMemory(id: number, content: string): boolean {
  const result = db.prepare("UPDATE memories SET content = ?, updated_at = ? WHERE id = ?").run(content, Date.now(), id);
  return result.changes > 0;
}

export function deleteMemory(id: number): boolean {
  return db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
}

// ─── Pending Actions ─────────────────────────────────────────

export interface PendingActionRow {
  id: string;
  conversation_id: number | null;
  tool: string;
  args: string;
  summary: string;
  status: "pending" | "approved" | "denied" | "expired";
  created_at: number;
}

const ACTION_TTL_MS = 15 * 60 * 1000;

export function insertPendingAction(id: string, conversationId: number | null, tool: string, args: unknown, summary: string): void {
  db.prepare("INSERT INTO pending_actions (id, conversation_id, tool, args, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, conversationId, tool, JSON.stringify(args), summary, Date.now());
}

function expireOldActions(): void {
  db.prepare("UPDATE pending_actions SET status = 'expired' WHERE status = 'pending' AND created_at < ?")
    .run(Date.now() - ACTION_TTL_MS);
}

export function getPendingAction(id: string): PendingActionRow | undefined {
  expireOldActions();
  return db.prepare("SELECT * FROM pending_actions WHERE id = ? AND status = 'pending'").get(id) as PendingActionRow | undefined;
}

export function listPendingActions(conversationId?: number): PendingActionRow[] {
  expireOldActions();
  if (conversationId !== undefined) {
    return db.prepare("SELECT * FROM pending_actions WHERE status = 'pending' AND conversation_id = ? ORDER BY created_at")
      .all(conversationId) as unknown as PendingActionRow[];
  }
  return db.prepare("SELECT * FROM pending_actions WHERE status = 'pending' ORDER BY created_at").all() as unknown as PendingActionRow[];
}

/** Atomically claims a pending action; returns false if it was already resolved. */
export function resolvePendingAction(id: string, status: "approved" | "denied"): boolean {
  return db.prepare("UPDATE pending_actions SET status = ? WHERE id = ? AND status = 'pending'").run(status, id).changes > 0;
}

// ─── Reminders ───────────────────────────────────────────────

export type ReminderRepeat = "none" | "daily" | "weekdays" | "weekly";

export interface ReminderRow {
  id: number;
  conversation_id: number | null;
  message: string;
  due_at: number;
  repeat: ReminderRepeat;
  status: "pending" | "fired" | "cancelled";
  created_at: number;
}

export function insertReminder(conversationId: number | null, message: string, dueAt: number, repeat: ReminderRepeat): ReminderRow {
  const now = Date.now();
  const result = db.prepare("INSERT INTO reminders (conversation_id, message, due_at, repeat, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(conversationId, message, dueAt, repeat, now);
  return { id: Number(result.lastInsertRowid), conversation_id: conversationId, message, due_at: dueAt, repeat, status: "pending", created_at: now };
}

export function getKv(key: string): string | undefined {
  return (db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

export function setKv(key: string, value: string): void {
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function listUpcomingReminders(): ReminderRow[] {
  return db.prepare("SELECT * FROM reminders WHERE status = 'pending' ORDER BY due_at").all() as unknown as ReminderRow[];
}

export function listDueReminders(now: number): ReminderRow[] {
  return db.prepare("SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at").all(now) as unknown as ReminderRow[];
}

export function cancelReminder(id: number): boolean {
  return db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(id).changes > 0;
}

export function markReminderFired(id: number): void {
  db.prepare("UPDATE reminders SET status = 'fired' WHERE id = ?").run(id);
}

export function rescheduleReminder(id: number, dueAt: number): void {
  db.prepare("UPDATE reminders SET due_at = ? WHERE id = ?").run(dueAt, id);
}
