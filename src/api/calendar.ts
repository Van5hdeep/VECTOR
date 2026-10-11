import type { GoogleCalendarEvent, CalendarEventFormData } from "../types/vector";

/**
 * Check Google Calendar connection status.
 */
export async function getCalendarStatus(): Promise<{ connected: boolean; credentialsFound: boolean }> {
  const res = await fetch("/api/calendar/status");
  if (!res.ok) throw new Error("Failed to check calendar status.");
  return res.json();
}

/**
 * Get the Google OAuth authorization URL.
 */
export async function getAuthUrl(): Promise<string> {
  const res = await fetch("/api/calendar/auth");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to get authorization URL.");
  }
  const data = await res.json();
  return data.authUrl;
}

/**
 * Disconnect Google Calendar.
 */
export async function disconnectCalendar(): Promise<void> {
  const res = await fetch("/api/calendar/disconnect", { method: "POST" });
  if (!res.ok) throw new Error("Failed to disconnect Google Calendar.");
}

/** Error carrying the server's reason code (GOOGLE_RECONNECT, GOOGLE_DISCONNECTED). */
export class CalendarError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Fetch calendar events, optionally within a date range (defaults to upcoming).
 */
export async function getCalendarEvents(from?: Date, to?: Date): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from.toISOString());
  if (to) params.set("to", to.toISOString());
  const res = await fetch(`/api/calendar/events${params.size ? `?${params}` : ""}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new CalendarError(data.error || "Failed to fetch calendar events.", data.code);
  }
  const data = await res.json();
  return data.events;
}

/**
 * Create a new calendar event.
 */
export async function createCalendarEvent(formData: CalendarEventFormData): Promise<GoogleCalendarEvent> {
  const body = formDataToEventBody(formData);
  const res = await fetch("/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to create event.");
  }
  const data = await res.json();
  return data.event;
}

/**
 * Update an existing calendar event.
 */
export async function updateCalendarEvent(
  eventId: string,
  formData: CalendarEventFormData
): Promise<GoogleCalendarEvent> {
  const body = formDataToEventBody(formData);
  const res = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to update event.");
  }
  const data = await res.json();
  return data.event;
}

/**
 * Delete a calendar event.
 */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const res = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to delete event.");
  }
}

/**
 * Convert form data to the API event body format.
 */
function formDataToEventBody(formData: CalendarEventFormData) {
  const startDateTime = `${formData.date}T${formData.startTime}:00`;
  const endDateTime = `${formData.date}T${formData.endTime}:00`;

  // Use the browser's timezone to create proper ISO strings
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return {
    summary: formData.summary,
    description: formData.description || undefined,
    location: formData.location || undefined,
    start: { dateTime: startDateTime, timeZone },
    end: { dateTime: endDateTime, timeZone },
  };
}
