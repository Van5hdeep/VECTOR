import { useState, useEffect, useCallback } from "react";
import type { GoogleCalendarEvent, CalendarEventFormData } from "../types/vector";
import {
  getCalendarStatus,
  getAuthUrl,
  disconnectCalendar,
  getCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "../api/calendar";
import CalendarEventForm from "./CalendarEventForm";

interface CalendarWorkspaceProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after any mutation so the dashboard card can refresh */
  onEventsChanged?: () => void;
}

type WorkspaceView = "list" | "detail" | "create" | "edit";

// ─── Helpers ─────────────────────────────────────────────────

function formatEventTime(event: GoogleCalendarEvent): string {
  if (event.start.date) {
    return "All day";
  }
  if (event.start.dateTime) {
    return new Date(event.start.dateTime).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return "";
}

function formatEventEndTime(event: GoogleCalendarEvent): string {
  if (event.end.dateTime) {
    return new Date(event.end.dateTime).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return "";
}

function formatEventDate(event: GoogleCalendarEvent): string {
  const dateStr = event.start.dateTime || event.start.date;
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString([], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getEventDateKey(event: GoogleCalendarEvent): string {
  const dateStr = event.start.dateTime || event.start.date;
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getDayLabel(dateKey: string): string {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  if (dateKey === todayKey) return "TODAY";
  if (dateKey === tomorrowKey) return "TOMORROW";

  const d = new Date(dateKey + "T00:00:00");
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }).toUpperCase();
}

function groupEventsByDay(events: GoogleCalendarEvent[]): Map<string, GoogleCalendarEvent[]> {
  const groups = new Map<string, GoogleCalendarEvent[]>();
  for (const event of events) {
    const key = getEventDateKey(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(event);
  }
  return groups;
}

// Assign a deterministic color to each event based on its ID
const EVENT_COLORS = ["#00C8FF", "#C850C0", "#00E676", "#FFB300", "#FF5252", "#7C4DFF", "#18FFFF", "#FF6E40"];
function getEventColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return EVENT_COLORS[Math.abs(hash) % EVENT_COLORS.length];
}

// ═════════════════════════════════════════════════════════════

const CalendarWorkspace = ({ isOpen, onClose, onEventsChanged }: CalendarWorkspaceProps) => {
  const [connected, setConnected] = useState(false);
  const [credentialsFound, setCredentialsFound] = useState(true);
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<WorkspaceView>("list");
  const [selectedEvent, setSelectedEvent] = useState<GoogleCalendarEvent | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // ─── Data Fetching ───────────────────────────────────────

  const checkStatus = useCallback(async () => {
    try {
      const status = await getCalendarStatus();
      setConnected(status.connected);
      setCredentialsFound(status.credentialsFound);
      return status.connected;
    } catch {
      setConnected(false);
      return false;
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getCalendarEvents();
      setEvents(data);
    } catch (err) {
      setError((err as Error).message || "Failed to load events.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const isConnected = await checkStatus();
    if (isConnected) {
      await fetchEvents();
    } else {
      setLoading(false);
    }
  }, [checkStatus, fetchEvents]);

  useEffect(() => {
    if (isOpen) {
      refreshAll();
    }
  }, [isOpen, refreshAll]);

  // ─── Actions ─────────────────────────────────────────────

  const handleConnect = async () => {
    try {
      const authUrl = await getAuthUrl();
      window.open(authUrl, "_blank");
    } catch (err) {
      setError((err as Error).message || "Failed to start authorization.");
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectCalendar();
      setConnected(false);
      setEvents([]);
      setView("list");
      setSelectedEvent(null);
    } catch (err) {
      setError((err as Error).message || "Failed to disconnect.");
    }
  };

  const handleCreateEvent = async (formData: CalendarEventFormData) => {
    await createCalendarEvent(formData);
    await fetchEvents();
    onEventsChanged?.();
    setView("list");
  };

  const handleUpdateEvent = async (formData: CalendarEventFormData) => {
    if (!selectedEvent) return;
    await updateCalendarEvent(selectedEvent.id, formData);
    await fetchEvents();
    onEventsChanged?.();
    setView("list");
    setSelectedEvent(null);
  };

  const handleDeleteEvent = async () => {
    if (!selectedEvent) return;
    try {
      await deleteCalendarEvent(selectedEvent.id);
      await fetchEvents();
      onEventsChanged?.();
      setView("list");
      setSelectedEvent(null);
      setDeleteConfirm(false);
    } catch (err) {
      setError((err as Error).message || "Failed to delete event.");
      setDeleteConfirm(false);
    }
  };

  const handleSelectEvent = (event: GoogleCalendarEvent) => {
    setSelectedEvent(event);
    setView("detail");
    setDeleteConfirm(false);
  };

  const handleBack = () => {
    setView("list");
    setSelectedEvent(null);
    setDeleteConfirm(false);
  };

  // ─── Listen for OAuth completion ─────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("calendar_connected") === "true") {
      // Clean the URL
      window.history.replaceState({}, "", window.location.pathname);
      refreshAll();
    }
  }, [refreshAll]);

  // Poll for connection status changes when workspace is open and not connected
  // (user might be completing OAuth in another tab)
  useEffect(() => {
    if (!isOpen || connected) return;
    const interval = setInterval(async () => {
      const isNow = await checkStatus();
      if (isNow) {
        await fetchEvents();
        onEventsChanged?.();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isOpen, connected, checkStatus, fetchEvents, onEventsChanged]);

  // ─── Render ──────────────────────────────────────────────

  if (!isOpen) return null;

  const dayGroups = groupEventsByDay(events);

  return (
    <div className="cal-workspace">
      {/* Header */}
      <div className="cal-workspace__header">
        <div className="cal-workspace__header-left">
          {view !== "list" && (
            <button
              className="cal-workspace__btn cal-workspace__btn--back"
              onClick={handleBack}
              aria-label="Back"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 3L5 7L9 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <span className="cal-workspace__title">CALENDAR</span>
          {connected && (
            <span className="cal-status-dot cal-status-dot--connected" title="Connected to Google Calendar" />
          )}
        </div>
        <div className="cal-workspace__header-right">
          {connected && view === "list" && (
            <>
              <button
                className="cal-workspace__btn"
                onClick={() => setView("create")}
                aria-label="Add event"
                title="Add event"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              <button
                className="cal-workspace__btn"
                onClick={refreshAll}
                aria-label="Refresh"
                title="Refresh"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M11.5 7A4.5 4.5 0 1 1 7 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M7 2.5L9.5 2.5L9.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
          <button
            className="cal-workspace__btn cal-workspace__btn--close"
            onClick={onClose}
            aria-label="Close calendar"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="3" y1="3" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" />
              <line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="cal-workspace__divider" />

      {/* Body */}
      <div className="cal-workspace__body">
        {/* Error message */}
        {error && (
          <div className="cal-workspace__error">
            {error}
            <button className="cal-workspace__error-dismiss" onClick={() => setError("")}>×</button>
          </div>
        )}

        {/* Not connected state */}
        {!connected && !loading && (
          <div className="cal-connect">
            <div className="cal-connect__icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <rect x="6" y="8" width="28" height="26" rx="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
                <line x1="6" y1="16" x2="34" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.4" />
                <line x1="14" y1="5" x2="14" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="26" y1="5" x2="26" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            {credentialsFound ? (
              <>
                <p className="cal-connect__text">Connect your Google Calendar to view and manage events.</p>
                <button className="cal-connect__btn" onClick={handleConnect}>
                  Connect Google Calendar
                </button>
              </>
            ) : (
              <p className="cal-connect__text">
                Google Calendar credentials not found. Place the OAuth credential JSON in server/credentials/.
              </p>
            )}
          </div>
        )}

        {/* Loading state */}
        {connected && loading && (
          <div className="cal-workspace__loading">
            <div className="cal-workspace__spinner" />
            <span>Loading events...</span>
          </div>
        )}

        {/* List view */}
        {connected && !loading && view === "list" && (
          <div className="cal-event-list">
            {events.length === 0 ? (
              <div className="cal-event-list__empty">No upcoming events</div>
            ) : (
              Array.from(dayGroups.entries()).map(([dateKey, dayEvents]) => (
                <div key={dateKey} className="cal-day-group">
                  <div className="cal-day-group__label">{getDayLabel(dateKey)}</div>
                  {dayEvents.map((event) => (
                    <button
                      key={event.id}
                      className="cal-event-item"
                      onClick={() => handleSelectEvent(event)}
                    >
                      <span
                        className="cal-event-item__dot"
                        style={{
                          backgroundColor: getEventColor(event.id),
                          boxShadow: `0 0 6px ${getEventColor(event.id)}40`,
                        }}
                      />
                      <span className="cal-event-item__time">{formatEventTime(event)}</span>
                      <span className="cal-event-item__title">{event.summary}</span>
                      {event.recurringEventId && (
                        <span className="cal-event-item__recurring" title="Recurring event">↻</span>
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}

            {/* Disconnect option */}
            {connected && (
              <div className="cal-workspace__footer">
                <button className="cal-workspace__disconnect" onClick={handleDisconnect}>
                  Disconnect Google Calendar
                </button>
              </div>
            )}
          </div>
        )}

        {/* Detail view */}
        {view === "detail" && selectedEvent && (
          <div className="cal-detail">
            <div className="cal-detail__header">
              <span
                className="cal-detail__dot"
                style={{
                  backgroundColor: getEventColor(selectedEvent.id),
                  boxShadow: `0 0 8px ${getEventColor(selectedEvent.id)}40`,
                }}
              />
              <h2 className="cal-detail__title">{selectedEvent.summary}</h2>
            </div>

            <div className="cal-detail__meta">
              <div className="cal-detail__row">
                <span className="cal-detail__label">Date</span>
                <span className="cal-detail__value">{formatEventDate(selectedEvent)}</span>
              </div>
              <div className="cal-detail__row">
                <span className="cal-detail__label">Time</span>
                <span className="cal-detail__value">
                  {selectedEvent.start.date
                    ? "All day"
                    : `${formatEventTime(selectedEvent)} — ${formatEventEndTime(selectedEvent)}`}
                </span>
              </div>
              {selectedEvent.location && (
                <div className="cal-detail__row">
                  <span className="cal-detail__label">Location</span>
                  <span className="cal-detail__value">{selectedEvent.location}</span>
                </div>
              )}
              {selectedEvent.description && (
                <div className="cal-detail__row cal-detail__row--block">
                  <span className="cal-detail__label">Description</span>
                  <p className="cal-detail__description">{selectedEvent.description}</p>
                </div>
              )}
              {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                <div className="cal-detail__row cal-detail__row--block">
                  <span className="cal-detail__label">Attendees</span>
                  <div className="cal-detail__attendees">
                    {selectedEvent.attendees.map((a, i) => (
                      <span key={i} className="cal-detail__attendee">
                        {a.displayName || a.email}
                        {a.responseStatus && (
                          <span className={`cal-detail__rsvp cal-detail__rsvp--${a.responseStatus}`}>
                            {a.responseStatus === "accepted" ? "✓" : a.responseStatus === "declined" ? "✗" : "?"}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {selectedEvent.recurringEventId && (
                <div className="cal-detail__row">
                  <span className="cal-detail__label">Recurrence</span>
                  <span className="cal-detail__value">Recurring event</span>
                </div>
              )}
              {selectedEvent.htmlLink && (
                <div className="cal-detail__row">
                  <span className="cal-detail__label">Link</span>
                  <a
                    className="cal-detail__link"
                    href={selectedEvent.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Google Calendar ↗
                  </a>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="cal-detail__actions">
              <button
                className="cal-detail__action-btn cal-detail__action-btn--edit"
                onClick={() => setView("edit")}
              >
                Edit
              </button>
              {!deleteConfirm ? (
                <button
                  className="cal-detail__action-btn cal-detail__action-btn--delete"
                  onClick={() => setDeleteConfirm(true)}
                >
                  Delete
                </button>
              ) : (
                <div className="cal-detail__confirm">
                  <span className="cal-detail__confirm-text">Delete this event?</span>
                  <button
                    className="cal-detail__action-btn cal-detail__action-btn--confirm-yes"
                    onClick={handleDeleteEvent}
                  >
                    Yes, delete
                  </button>
                  <button
                    className="cal-detail__action-btn cal-detail__action-btn--confirm-no"
                    onClick={() => setDeleteConfirm(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Create view */}
        {view === "create" && (
          <CalendarEventForm
            onSubmit={handleCreateEvent}
            onCancel={handleBack}
          />
        )}

        {/* Edit view */}
        {view === "edit" && selectedEvent && (
          <CalendarEventForm
            event={selectedEvent}
            onSubmit={handleUpdateEvent}
            onCancel={() => setView("detail")}
          />
        )}
      </div>
    </div>
  );
};

export default CalendarWorkspace;
