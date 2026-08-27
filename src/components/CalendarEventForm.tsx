import { useState } from "react";
import type { CalendarEventFormData, GoogleCalendarEvent } from "../types/vector";

interface CalendarEventFormProps {
  /** If provided, the form is in edit mode with pre-filled values */
  event?: GoogleCalendarEvent;
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
    date = startDate.toISOString().split("T")[0];
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

const CalendarEventForm = ({ event, onSubmit, onCancel }: CalendarEventFormProps) => {
  const prefill = event ? extractDateTime(event) : null;

  const [summary, setSummary] = useState(event?.summary || "");
  const [description, setDescription] = useState(event?.description || "");
  const [location, setLocation] = useState(event?.location || "");
  const [date, setDate] = useState(prefill?.date || "");
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
        {event ? "EDIT EVENT" : "NEW EVENT"}
      </div>

      <form onSubmit={handleSubmit} className="cal-form__body">
        <div className="cal-form__field">
          <label className="cal-form__label">Title *</label>
          <input
            className="cal-form__input"
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Event title"
            autoFocus
          />
        </div>

        <div className="cal-form__field">
          <label className="cal-form__label">Date *</label>
          <input
            className="cal-form__input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="cal-form__row">
          <div className="cal-form__field cal-form__field--half">
            <label className="cal-form__label">Start *</label>
            <input
              className="cal-form__input"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="cal-form__field cal-form__field--half">
            <label className="cal-form__label">End *</label>
            <input
              className="cal-form__input"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>

        <div className="cal-form__field">
          <label className="cal-form__label">Location</label>
          <input
            className="cal-form__input"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Add location"
          />
        </div>

        <div className="cal-form__field">
          <label className="cal-form__label">Description</label>
          <textarea
            className="cal-form__input cal-form__textarea"
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
            {submitting ? "Saving..." : event ? "Save Changes" : "Create Event"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CalendarEventForm;
