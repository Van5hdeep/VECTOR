import { useState } from "react";
import type { CalendarEventFormData, GoogleCalendarEvent } from "../types/vector";

interface CalendarEventFormProps {
  /** If provided, the form is in edit mode with pre-filled values */
  event?: GoogleCalendarEvent;
  /** Pre-selected date (YYYY-MM-DD) for new events */
  defaultDate?: string;
  onSubmit: (data: CalendarEventFormData) => Promise<void>;
  onCancel: () => void;
}

/** Extract date and time from a GoogleCalendarEvent for form pre-fill */
function extractDateTime(event: GoogleCalendarEvent): {
  date: string;
  startTime: string;
  endTime: string;
} {
  const startStr = event.start.dateTime || event.start.date || "";
  const endStr = event.end.dateTime || event.end.date || "";

  let date = "";
  let startTime = "";
  let endTime = "";

  if (event.start.dateTime) {
    const startDate = new Date(startStr);
    // Local calendar date (toISOString would shift late-evening events to the next UTC day)
    date = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
    startTime = startDate.toTimeString().slice(0, 5);
  } else if (event.start.date) {
    date = event.start.date;
  }

  if (event.end.dateTime) {
    const endDate = new Date(endStr);
    endTime = endDate.toTimeString().slice(0, 5);
  }

  return { date, startTime, endTime };
}

const CalendarEventForm = ({ event, defaultDate, onSubmit, onCancel }: CalendarEventFormProps) => {
  const prefill = event ? extractDateTime(event) : null;

  const [summary, setSummary] = useState(event?.summary || "");
  const [description, setDescription] = useState(event?.description || "");
  const [location, setLocation] = useState(event?.location || "");
  const [date, setDate] = useState(prefill?.date || defaultDate || "");
  const [startTime, setStartTime] = useState(prefill?.startTime || "");
  const [endTime, setEndTime] = useState(prefill?.endTime || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!summary.trim()) {
      setError("Title is required.");
      return;
    }
    if (!date) {
      setError("Date is required.");
      return;
    }
    if (!startTime) {
      setError("Start time is required.");
      return;
    }
    if (!endTime) {
      setError("End time is required.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        summary: summary.trim(),
        description: description.trim(),
        location: location.trim(),
        date,
        startTime,
        endTime,
      });
    } catch (err) {
      setError((err as Error).message || "An error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cal-form">
      <div className="cal-form__title">
        {event ? "Edit event" : "New event"}
      </div>

      <form onSubmit={handleSubmit} className="cal-form__body">
        <div className="cal-form__field">
          <label className="cal-form__label" htmlFor="cal-title">Title *</label>
          <input
            id="cal-title" className="cal-form__input"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Event title"
            autoFocus
          />
        </div>

        <div className="cal-form__field">
          <label className="cal-form__label" htmlFor="cal-date">Date *</label>
          <input
            id="cal-date" className="cal-form__input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="cal-form__row">
          <div className="cal-form__field cal-form__field--half">
            <label className="cal-form__label" htmlFor="cal-start">Start *</label>
            <input
              id="cal-start" className="cal-form__input"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="cal-form__field cal-form__field--half">
            <label className="cal-form__label" htmlFor="cal-end">End *</label>
            <input
              id="cal-end" className="cal-form__input"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>

        <div className="cal-form__field">
          <label className="cal-form__label" htmlFor="cal-location">Location</label>
          <input
            id="cal-location" className="cal-form__input"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Add location"
          />
        </div>

        <div className="cal-form__field">
          <label className="cal-form__label" htmlFor="cal-description">Description</label>
          <textarea
            id="cal-description" className="cal-form__input cal-form__textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description"
            rows={3}
          />
        </div>

        {error && <div className="cal-form__error">{error}</div>}

        <div className="cal-form__actions">
          <button
            type="button"
            className="cal-form__btn cal-form__btn--cancel"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="cal-form__btn cal-form__btn--submit"
            disabled={submitting}
          >
            {submitting ? "Saving…" : event ? "Save changes" : "Create event"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CalendarEventForm;
