import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  getCalendarStatus,
  getCalendarEvents,
  getAuthUrl,
  disconnectCalendar,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  CalendarError,
} from "../../api/calendar";
import type { GoogleCalendarEvent, CalendarEventFormData } from "../../types/vector";
import CalendarEventForm from "../CalendarEventForm";
import Icon from "../ui/Icon";
import { formatTime, isSameDay } from "../../lib/format";

type CalState = "loading" | "ok" | "disconnected" | "expired" | "nocreds" | "error";

interface CalendarCardProps {
  /** Tell the dashboard that Google's connection changed */
  onConnectionChange?: () => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function eventStart(e: GoogleCalendarEvent): Date {
  return e.start.dateTime ? new Date(e.start.dateTime) : new Date(`${e.start.date}T00:00:00`);
}

function isAllDay(e: GoogleCalendarEvent): boolean {
  return !e.start.dateTime;
}

function eventWhen(e: GoogleCalendarEvent): string {
  if (isAllDay(e)) return "All day";
  const end = e.end.dateTime ? new Date(e.end.dateTime) : null;
  return `${formatTime(eventStart(e))}${end ? `–${formatTime(end)}` : ""}`;
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 6×7 grid of dates starting on the Monday before the 1st */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export default function CalendarCard({ onConnectionChange }: CalendarCardProps) {
  const [state, setState] = useState<CalState>("loading");
  const [upcoming, setUpcoming] = useState<GoogleCalendarEvent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [frame, setFrame] = useState<CSSProperties | null>(null);
  const [placeholderH, setPlaceholderH] = useState(0);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [monthEvents, setMonthEvents] = useState<GoogleCalendarEvent[]>([]);
  const [selected, setSelected] = useState(() => new Date());
  const [form, setForm] = useState<{ event?: GoogleCalendarEvent } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);

  // ─── Data ─────────────────────────────────────────────────
  const loadUpcoming = useCallback(async () => {
    try {
      const status = await getCalendarStatus();
      if (!status.credentialsFound) return setState("nocreds");
      if (!status.connected) return setState("disconnected");
      setUpcoming(await getCalendarEvents());
      setState("ok");
    } catch (err) {
      setState(err instanceof CalendarError && err.code === "GOOGLE_RECONNECT" ? "expired" : "error");
    }
  }, []);

  const grid = useMemo(() => monthGrid(month), [month]);

  const loadMonth = useCallback(async () => {
    try {
      const to = new Date(grid[41]);
      to.setDate(to.getDate() + 1);
      setMonthEvents(await getCalendarEvents(grid[0], to));
    } catch (err) {
      if (err instanceof CalendarError && err.code === "GOOGLE_RECONNECT") setState("expired");
    }
  }, [grid]);

  useEffect(() => {
    void loadUpcoming();
    const id = window.setInterval(loadUpcoming, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [loadUpcoming]);

  useEffect(() => {
    if (expanded && state === "ok") void loadMonth();
  }, [expanded, state, loadMonth]);

  // Let the System card reflect what we just learned (e.g. an expired login)
  const notifyRef = useRef(onConnectionChange);
  notifyRef.current = onConnectionChange;
  useEffect(() => {
    if (state !== "loading") notifyRef.current?.();
  }, [state]);

  const refreshAll = async () => {
    await loadUpcoming();
    if (expanded) await loadMonth();
  };

  // ─── Google connect / reconnect (popup + poll) ─────────────
  const connect = async () => {
    setConnecting(true);
    try {
      if (state === "expired") await disconnectCalendar();
      const url = await getAuthUrl();
      const popup = window.open(url, "vector-google", "width=520,height=700");
      const started = Date.now();
      const poll = window.setInterval(async () => {
        const status = await getCalendarStatus().catch(() => null);
        if (status?.connected || Date.now() - started > 5 * 60 * 1000) {
          window.clearInterval(poll);
          popup?.close();
          setConnecting(false);
          await loadUpcoming();
          onConnectionChange?.();
        }
      }, 2500);
    } catch {
      setConnecting(false);
      setState("error");
    }
  };

  // ─── Expand / collapse (FLIP between rail slot and large panel) ─
  const targetFrame = (): CSSProperties => {
    const top = 76;
    const left = 24;
    const width = Math.min(860, window.innerWidth - 48);
    const height = Math.min(720, window.innerHeight - top - 104);
    return { position: "fixed", left, top, width, height };
  };

  const expand = () => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect || expanded) return;
    setPlaceholderH(rect.height);
    setFrame({ position: "fixed", left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    setExpanded(true);
  };

  useLayoutEffect(() => {
    if (!expanded || !frame || frame.width === targetFrame().width) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setFrame(targetFrame())));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const collapse = useCallback(() => {
    const rect = placeholderRef.current?.getBoundingClientRect();
    setForm(null);
    setConfirmId(null);
    if (!rect) {
      setExpanded(false);
      setFrame(null);
      return;
    }
    setFrame({ position: "fixed", left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    window.setTimeout(() => {
      setExpanded(false);
      setFrame(null);
    }, 330);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        collapse();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [expanded, collapse]);

  // ─── Event actions ─────────────────────────────────────────
  const saveEvent = async (data: CalendarEventFormData) => {
    if (form?.event) await updateCalendarEvent(form.event.id, data);
    else await createCalendarEvent(data);
    setForm(null);
    await refreshAll();
  };

  const removeEvent = async (id: string) => {
    setConfirmId(null);
    await deleteCalendarEvent(id);
    await refreshAll();
  };

  const eventsOn = (day: Date) => monthEvents.filter((e) => isSameDay(eventStart(e), day));
  const today = new Date();
  const selectedEvents = eventsOn(selected).sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
  const weekEnd = new Date(today.getTime() + 7 * 86_400_000);
  const thisWeek = upcoming.filter((e) => eventStart(e) < weekEnd).length;

  // ─── Render ────────────────────────────────────────────────
  const statusBlock = (
    state === "disconnected" || state === "expired" || state === "nocreds" || state === "error" ? (
      <div className="calcard__notice">
        <p>
          {state === "expired" && "Your Google login expired. Reconnect to see your events."}
          {state === "disconnected" && "Connect Google to see and manage your events."}
          {state === "nocreds" && "Add the Google OAuth credential file to server/credentials/ to enable the calendar."}
          {state === "error" && "I couldn't reach Google Calendar. Try again in a moment."}
        </p>
        {(state === "expired" || state === "disconnected") && (
          <button className="btn btn--primary" onClick={(e) => { e.stopPropagation(); void connect(); }} disabled={connecting}>
            {connecting ? "Waiting for Google…" : state === "expired" ? "Reconnect Google" : "Connect Google"}
          </button>
        )}
        {state === "error" && (
          <button className="btn" onClick={(e) => { e.stopPropagation(); void loadUpcoming(); }}>Try again</button>
        )}
      </div>
    ) : null
  );

  const compact = (
    <>
      <header className="rail-block__head">
        <h2 className="label">Calendar</h2>
        {state === "ok" && <span className="calcard__week">{thisWeek} this week</span>}
        <Icon name="calendar" size={15} className="calcard__open-icon" />
      </header>
      {statusBlock}
      {state === "ok" && (
        upcoming.length === 0 ? (
          <p className="rail-block__empty">Your calendar is clear.</p>
        ) : (
          <ul className="calcard__next">
            {upcoming.slice(0, 3).map((e) => {
              const start = eventStart(e);
              return (
                <li key={e.id}>
                  <span className="calcard__date num">
                    <b>{start.getDate()}</b>
                    {start.toLocaleDateString("en-GB", { month: "short" })}
                  </span>
                  <span className="calcard__info">
                    <span className="calcard__title">{e.summary}</span>
                    <span className="calcard__when">{isSameDay(start, today) ? "Today" : start.toLocaleDateString("en-GB", { weekday: "short" })} {eventWhen(e)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )
      )}
    </>
  );

  const full = (
    <div className="calx">
      <header className="calx__head">
        <div className="calx__month">
          <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
            <Icon name="back" size={16} />
          </button>
          <h2 className="calx__title">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h2>
          <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
            <Icon name="back" size={16} style={{ transform: "scaleX(-1)" }} />
          </button>
          <button className="btn btn--ghost" onClick={() => { const t = new Date(); setMonth(new Date(t.getFullYear(), t.getMonth(), 1)); setSelected(t); }}>
            Today
          </button>
        </div>
        <div className="calx__actions">
          {state === "ok" && (
            <button className="btn btn--primary" onClick={() => setForm({})}>
              <Icon name="plus" size={15} /> New event
            </button>
          )}
          <button className="icon-btn" onClick={collapse} aria-label="Close calendar">
            <Icon name="close" size={18} />
          </button>
        </div>
      </header>

      {state !== "ok" && state !== "loading" && <div className="calx__banner">{statusBlock}</div>}
      {(
        <div className="calx__body">
          <div className="calx__grid" role="grid" aria-label="Month">
            {WEEKDAYS.map((d) => <span key={d} className="calx__wd">{d}</span>)}
            {grid.map((day) => {
              const events = eventsOn(day);
              const classes = [
                "calx__day",
                day.getMonth() !== month.getMonth() ? "calx__day--out" : "",
                isSameDay(day, today) ? "calx__day--today" : "",
                isSameDay(day, selected) ? "calx__day--selected" : "",
              ].filter(Boolean).join(" ");
              return (
                <button key={toKey(day)} className={classes} onClick={() => { setSelected(day); setForm(null); }} aria-label={`${day.toDateString()}, ${events.length} events`}>
                  <span className="num">{day.getDate()}</span>
                  {events.length > 0 && (
                    <span className="calx__dots">
                      {events.slice(0, 3).map((e) => <i key={e.id} />)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <aside className="calx__agenda">
            {form ? (
              <CalendarEventForm
                event={form.event}
                defaultDate={toKey(selected)}
                onSubmit={saveEvent}
                onCancel={() => setForm(null)}
              />
            ) : (
              <>
                <h3 className="calx__day-title">{selected.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h3>
                {selectedEvents.length === 0 ? (
                  <p className="rail-block__empty">Nothing on this day.</p>
                ) : (
                  <ul className="calx__events">
                    {selectedEvents.map((e) => (
                      <li key={e.id} className="calx__event">
                        <span className="calx__event-time num">{eventWhen(e)}</span>
                        <div className="calx__event-body">
                          <span className="calx__event-title">{e.summary}</span>
                          {e.location && <span className="calx__event-meta"><Icon name="pin" size={12} /> {e.location}</span>}
                          {e.description && <span className="calx__event-meta">{e.description.slice(0, 140)}</span>}
                        </div>
                        {confirmId === e.id ? (
                          <span className="calx__confirm">
                            Delete?
                            <button className="btn btn--danger" onClick={() => removeEvent(e.id)}>Delete</button>
                            <button className="btn btn--ghost" onClick={() => setConfirmId(null)}>Keep</button>
                          </span>
                        ) : (
                          <span className="calx__event-actions">
                            <button className="icon-btn" onClick={() => setForm({ event: e })} aria-label={`Edit ${e.summary}`}><Icon name="edit" size={15} /></button>
                            <button className="icon-btn" onClick={() => setConfirmId(e.id)} aria-label={`Delete ${e.summary}`}><Icon name="trash" size={15} /></button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );

  return (
    <>
      {expanded && <div ref={placeholderRef} className="calcard__placeholder" style={{ height: placeholderH }} />}
      {expanded && <div className="calcard__backdrop" onClick={collapse} />}
      <div
        ref={cardRef}
        className={`calcard ${expanded ? "calcard--expanded" : ""}`}
        style={frame ?? undefined}
        role={expanded ? "dialog" : "button"}
        aria-label={expanded ? "Calendar" : "Open calendar"}
        tabIndex={expanded ? -1 : 0}
        onClick={expanded ? undefined : expand}
        onKeyDown={expanded ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); expand(); } }}
      >
        {expanded && frame?.width === targetFrame().width ? full : compact}
      </div>
    </>
  );
}
