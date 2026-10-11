import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Paths ───────────────────────────────────────────────────
const CREDENTIALS_DIR = path.join(__dirname, "credentials");
const TOKEN_PATH = path.join(CREDENTIALS_DIR, "token.json");

// OAuth scopes: full calendar access, plus Gmail read/compose/send/label (no permanent delete)
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const SCOPES = ["https://www.googleapis.com/auth/calendar", GMAIL_SCOPE];

// ─── Types ───────────────────────────────────────────────────

interface InstalledCredentials {
  installed: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
    auth_uri: string;
    token_uri: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StoredTokens = Record<string, any>;

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
}

export interface CalendarEventOutput {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status?: string;
  htmlLink?: string;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  recurrence?: string[];
  recurringEventId?: string;
}

// ─── Credential Loading ──────────────────────────────────────

function findCredentialFile(): string | null {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    return null;
  }
  const files = fs.readdirSync(CREDENTIALS_DIR);
  const credFile = files.find(
    (f) => f.startsWith("client_secret") && f.endsWith(".json") && f !== "token.json"
  );
  return credFile ? path.join(CREDENTIALS_DIR, credFile) : null;
}

function loadCredentials(): InstalledCredentials | null {
  const credPath = findCredentialFile();
  if (!credPath) {
    console.warn("[VECTOR_CORE] Google Calendar credential file not found in server/credentials/");
    return null;
  }
  try {
    const raw = fs.readFileSync(credPath, "utf-8");
    return JSON.parse(raw) as InstalledCredentials;
  } catch (err) {
    console.error("[VECTOR_CORE] Failed to read Google Calendar credentials:", (err as Error).message);
    return null;
  }
}

// ─── OAuth2 Client ───────────────────────────────────────────

// The redirect URI for Google's installed/desktop app OAuth flow.
// Desktop OAuth clients automatically support http://localhost redirects
// without needing to register them in the Google Cloud Console.
const OAUTH_REDIRECT_URI = "http://localhost:3001/api/calendar/oauth/callback";

function createOAuth2Client() {
  const creds = loadCredentials();
  if (!creds) return null;

  const { client_id, client_secret } = creds.installed;
  return new google.auth.OAuth2(client_id, client_secret, OAUTH_REDIRECT_URI);
}

// ─── Token Management ────────────────────────────────────────

function loadStoredTokens(): StoredTokens | null {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    const raw = fs.readFileSync(TOKEN_PATH, "utf-8");
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

function saveTokens(tokens: StoredTokens): void {
  // Ensure the credentials directory exists
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf-8");
}

function deleteTokens(): void {
  if (fs.existsSync(TOKEN_PATH)) {
    fs.unlinkSync(TOKEN_PATH);
  }
}

// ─── Authenticated Client ────────────────────────────────────

export function getAuthenticatedClient() {
  const client = createOAuth2Client();
  if (!client) return null;

  const tokens = loadStoredTokens();
  if (!tokens || !tokens.refresh_token) return null;

  client.setCredentials({
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
    token_type: tokens.token_type ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
    scope: tokens.scope ?? undefined,
  });
  
  // When tokens are refreshed automatically, persist the new tokens
  client.on("tokens", (newTokens) => {
    const existing = loadStoredTokens() || {};
    const merged = { ...existing, ...newTokens } as StoredTokens;
    saveTokens(merged);
  });

  return client;
}

// ─── Expired-login Tracking ──────────────────────────────────
// Google returns invalid_grant when the stored refresh token is revoked or
// expired (7 days for OAuth apps in "Testing"). Remember it so the UI can say so.

let authExpired = false;

function isInvalidGrant(err: unknown): boolean {
  const e = err as { message?: string; response?: { data?: { error?: string } } };
  return e?.response?.data?.error === "invalid_grant" || /invalid_grant/i.test(e?.message ?? "");
}

/** Runs a Google API call, translating an expired login into a clear error. */
export async function trackGoogleCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    authExpired = false;
    return result;
  } catch (err) {
    if (isInvalidGrant(err)) {
      authExpired = true;
      throw new Error("Google login expired. Reconnect Google from the Calendar card.");
    }
    throw err;
  }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Check whether Google Calendar is connected (valid token exists).
 */
export function getAuthStatus(): { connected: boolean; credentialsFound: boolean; gmailGranted: boolean; expired: boolean } {
  const creds = loadCredentials();
  const tokens = loadStoredTokens();
  const connected = !!(creds && tokens?.refresh_token);
  return {
    connected,
    credentialsFound: !!creds,
    gmailGranted: connected && String(tokens?.scope ?? "").split(" ").includes(GMAIL_SCOPE),
    expired: connected && authExpired,
  };
}

/**
 * Generate the Google OAuth authorization URL.
 */
export function getAuthUrl(state: string): string | null {
  const client = createOAuth2Client();
  if (!client) return null;

  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
}

/**
 * Exchange an authorization code for tokens and store them.
 */
export async function handleOAuthCallback(code: string): Promise<void> {
  const client = createOAuth2Client();
  if (!client) {
    throw new Error("Google Calendar credentials not configured.");
  }

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    // Merge with existing tokens if refresh_token isn't returned
    const existing = loadStoredTokens();
    if (existing?.refresh_token) {
      tokens.refresh_token = existing.refresh_token;
    }
  }
  saveTokens(tokens as StoredTokens);
  authExpired = false;
}

/**
 * Disconnect Google Calendar by deleting stored tokens.
 */
export function disconnect(): void {
  deleteTokens();
}

/**
 * List upcoming events from the user's primary calendar.
 */
export async function listEvents(
  maxResults = 50,
  timeMin?: string,
  timeMax?: string
): Promise<CalendarEventOutput[]> {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error("Google Calendar is not connected.");

  const calendar = google.calendar({ version: "v3", auth });

  const params: calendar_v3.Params$Resource$Events$List = {
    calendarId: "primary",
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
    timeMin: timeMin || new Date().toISOString(),
  };

  if (timeMax) {
    params.timeMax = timeMax;
  }

  const response = await trackGoogleCall(() => calendar.events.list(params));
  const events = response.data.items || [];

  return events.map(mapEvent);
}

/**
 * Create a new event on the user's primary calendar.
 */
export async function createEvent(eventData: CalendarEventInput): Promise<CalendarEventOutput> {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error("Google Calendar is not connected.");

  const calendar = google.calendar({ version: "v3", auth });

  const response = await trackGoogleCall(() => calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: eventData.summary,
      description: eventData.description,
      location: eventData.location,
      start: eventData.start,
      end: eventData.end,
    },
  }));

  return mapEvent(response.data);
}

/**
 * Update (patch) an existing event on the user's primary calendar.
 */
export async function updateEvent(
  eventId: string,
  eventData: Partial<CalendarEventInput>
): Promise<CalendarEventOutput> {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error("Google Calendar is not connected.");

  const calendar = google.calendar({ version: "v3", auth });

  const response = await trackGoogleCall(() => calendar.events.patch({
    calendarId: "primary",
    eventId,
    requestBody: {
      summary: eventData.summary,
      description: eventData.description,
      location: eventData.location,
      start: eventData.start,
      end: eventData.end,
    },
  }));

  return mapEvent(response.data);
}

/**
 * Delete an event from the user's primary calendar.
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error("Google Calendar is not connected.");

  const calendar = google.calendar({ version: "v3", auth });

  await trackGoogleCall(() => calendar.events.delete({
    calendarId: "primary",
    eventId,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────

function mapEvent(event: calendar_v3.Schema$Event): CalendarEventOutput {
  return {
    id: event.id || "",
    summary: event.summary || "(No title)",
    description: event.description || undefined,
    location: event.location || undefined,
    start: {
      dateTime: event.start?.dateTime || undefined,
      date: event.start?.date || undefined,
      timeZone: event.start?.timeZone || undefined,
    },
    end: {
      dateTime: event.end?.dateTime || undefined,
      date: event.end?.date || undefined,
      timeZone: event.end?.timeZone || undefined,
    },
    status: event.status || undefined,
    htmlLink: event.htmlLink || undefined,
    attendees: event.attendees?.map((a) => ({
      email: a.email || "",
      displayName: a.displayName || undefined,
      responseStatus: a.responseStatus || undefined,
    })),
    recurrence: event.recurrence || undefined,
    recurringEventId: event.recurringEventId || undefined,
  };
}
