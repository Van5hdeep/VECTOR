import {
  listDueReminders,
  markReminderFired,
  rescheduleReminder,
  addMessage,
  getConversation,
  getLatestConversation,
  type ReminderRepeat,
} from "./db.js";
import { broadcast } from "./events.js";
import { showToast } from "./notify.js";

const TICK_MS = 15_000;

/** Next due time for a repeating reminder, skipping any occurrences missed while offline. */
export function nextOccurrence(dueAt: number, repeat: ReminderRepeat, now = Date.now()): number | null {
  if (repeat === "none") return null;
  const next = new Date(dueAt);
  do {
    if (repeat === "weekly") {
      next.setDate(next.getDate() + 7);
    } else {
      next.setDate(next.getDate() + 1);
      if (repeat === "weekdays") {
        while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
      }
    }
  } while (next.getTime() <= now);
  return next.getTime();
}

function fireDueReminders(): void {
  const now = Date.now();
  for (const reminder of listDueReminders(now)) {
    const late = now - reminder.due_at > 5 * 60 * 1000;
    const when = new Date(reminder.due_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const text = late
      ? `A reminder I couldn't deliver at ${when}: ${reminder.message}`
      : `Reminder: ${reminder.message}`;

    showToast("VECTOR", reminder.message);

    // Record it in the conversation it was set from, so it is part of memory
    const conversation =
      (reminder.conversation_id !== null && getConversation(reminder.conversation_id)) || getLatestConversation();
    if (conversation) addMessage(conversation.id, "assistant", text);

    broadcast({ type: "reminder", id: reminder.id, conversationId: conversation?.id ?? null, text });
    broadcast({ type: "reminders_changed" });

    const next = nextOccurrence(reminder.due_at, reminder.repeat, now);
    if (next) rescheduleReminder(reminder.id, next);
    else markReminderFired(reminder.id);

    console.log(`[VECTOR_SCHEDULER] Reminder #${reminder.id} fired${next ? `, next at ${new Date(next).toLocaleString()}` : ""}`);
  }
}

export function startScheduler(): void {
  const tick = () => {
    try {
      fireDueReminders();
    } catch (err) {
      console.error("[VECTOR_SCHEDULER] Tick failed:", (err as Error).message);
    }
  };
  tick();
  setInterval(tick, TICK_MS);
}

