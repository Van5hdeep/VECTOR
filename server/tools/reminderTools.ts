import {
  insertReminder,
  listUpcomingReminders,
  cancelReminder,
  type ReminderRepeat,
} from "../db.js";
import { broadcast } from "../events.js";
import type { VectorTool } from "./types.js";
import { ToolError } from "./types.js";

const REPEATS: ReminderRepeat[] = ["none", "daily", "weekdays", "weekly"];

function formatLocal(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Accepts minutes-from-now, or a local "YYYY-MM-DDTHH:mm" / full ISO timestamp. */
function parseDue(at: unknown, inMinutes: unknown): number {
  if (inMinutes !== undefined && inMinutes !== null && inMinutes !== "") {
    const minutes = Number(inMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) throw new ToolError("in_minutes must be a positive number.");
    return Date.now() + minutes * 60_000;
  }
  if (typeof at === "string" && at.trim()) {
    // Without an offset, JS parses date-times as local time (this PC's timezone)
    const due = new Date(at.trim()).getTime();
    if (Number.isNaN(due)) throw new ToolError(`Could not understand the time "${at}". Use YYYY-MM-DDTHH:mm.`);
    return due;
  }
  throw new ToolError("Provide either 'at' or 'in_minutes'.");
}

export const reminderTools: VectorTool[] = [
  {
    name: "reminders",
    description: "Manage the user's reminders. They fire as a Windows notification and a message from you, even if the VECTOR window is closed (while the server runs). For relative times ('in 20 minutes') use in_minutes; otherwise 'at' as local time YYYY-MM-DDTHH:mm, worked out from the current date/time in context.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "list", "cancel"] },
        message: { type: "string", description: "What to remind the user about (create)." },
        at: { type: "string", description: "Local date-time, e.g. 2026-10-10T18:30 (create)." },
        in_minutes: { type: "number", description: "Minutes from now (create)." },
        repeat: { type: "string", enum: REPEATS, description: "Default none." },
        id: { type: "integer", description: "Reminder id (cancel)." },
      },
      required: ["action"],
    },
    run: (args, ctx) => {
      switch (args.action) {
        case "create": {
          const message = String(args.message ?? "").trim();
          if (!message) throw new ToolError("message is required");
          const due = parseDue(args.at, args.in_minutes);
          if (due < Date.now() - 60_000) throw new ToolError(`That time (${formatLocal(due)}) is in the past.`);
          const repeat: ReminderRepeat = REPEATS.includes(args.repeat) ? args.repeat : "none";
          const reminder = insertReminder(ctx.conversationId, message, due, repeat);
          broadcast({ type: "reminders_changed" });
          return { created: true, id: reminder.id, due: formatLocal(due), repeat };
        }
        case "list":
          return listUpcomingReminders().map((r) => ({ id: r.id, message: r.message, due: formatLocal(r.due_at), repeat: r.repeat }));
        case "cancel": {
          const cancelled = cancelReminder(Number(args.id));
          if (cancelled) broadcast({ type: "reminders_changed" });
          return { cancelled };
        }
        default:
          throw new ToolError(`Unknown action: ${args.action}`);
      }
    },
  },
];
