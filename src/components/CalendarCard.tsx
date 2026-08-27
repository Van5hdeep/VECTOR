import { useState, useEffect, useCallback } from "react";
import type { GoogleCalendarEvent } from "../types/vector";
import { getCalendarStatus, getCalendarEvents } from "../api/calendar";

interface CalendarCardProps {
  onOpenCalendar?: () => void;
  /** Increment this counter to trigger a refresh from outside */
  refreshTrigger?: number;
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

const CalendarCard = ({ onOpenCalendar, refreshTrigger }: CalendarCardProps) => {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const status = await getCalendarStatus();
      setConnected(status.connected);
      if (status.connected) {
        const data = await getCalendarEvents();
        setEvents(data.slice(0, 4)); // Show at most 4 events on the card
      } else {
        setEvents([]);
      }
    } catch {
      // Silently handle — card will show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  // Listen for OAuth completion via URL param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("calendar_connected") === "true") {
      loadData();
    }
  }, [loadData]);

  return (
    <div className="card" onClick={onOpenCalendar} style={{ cursor: onOpenCalendar ? "pointer" : undefined }}>
      <div className="card__header">
        <span className="card__title">
          CALENDAR
          {connected && <span className="cal-status-dot cal-status-dot--connected cal-status-dot--inline" />}
        </span>
        <span className="card__icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1" fill="none" />
            <line x1="2" y1="6.5" x2="14" y2="6.5" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
            <line x1="5.5" y1="2" x2="5.5" y2="4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <line x1="10.5" y1="2" x2="10.5" y2="4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </span>
      </div>
      <div className="card__body">
        {loading ? (
          <div className="calendar__loading">Loading...</div>
        ) : !connected ? (
          <div className="calendar__not-connected">
            <span className="calendar__connect-text">Connect Google Calendar</span>
            <span className="calendar__connect-arrow">→</span>
          </div>
        ) : events.length === 0 ? (
          <div className="calendar__empty">No upcoming events</div>
        ) : (
          <div className="calendar__list">
            {events.map((event) => (
              <div key={event.id} className="calendar__event">
                <span
                  className="calendar__event-dot"
                  style={{
                    backgroundColor: getEventColor(event.id),
                    boxShadow: `0 0 6px ${getEventColor(event.id)}40`,
                  }}
                />
                <span className="calendar__event-time">{formatEventTime(event)}</span>
                <span className="calendar__event-title">{event.summary}</span>
              </div>
            ))}
          </div>
        )}
        <div className="calendar__footer">
          <button className="calendar__view-all" onClick={(e) => { e.stopPropagation(); onOpenCalendar?.(); }}>
            View full calendar
            <span className="calendar__view-all-arrow">›</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CalendarCard;
