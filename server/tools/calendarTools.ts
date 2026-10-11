import {
  getAuthStatus,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  type CalendarEventInput,
  type CalendarEventOutput,
} from "../calendarService.js";
import type { ToolArgs, VectorTool } from "./types.js";
import { ToolError } from "./types.js";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function requireConnected(): void {
  if (!getAuthStatus().connected) {
    throw new ToolError("Google Calendar is not connected. The user can connect it from the Calendar panel.");
  }
}

/** Local "YYYY-MM-DDTHH:mm" → dated or timed Google event boundary. */
function toBoundary(value: unknown, allDay: boolean): CalendarEventInput["start"] {
  const text = String(value ?? "").trim();
  if (!text) throw new ToolError("start and end are required.");
  if (allDay) return { date: text.slice(0, 10) };
  const withSeconds = /T\d{2}:\d{2}$/.test(text) ? `${text}:00` : text;
  return { dateTime: withSeconds, timeZone: TIME_ZONE };
}

function brief(e: CalendarEventOutput) {
  return {
    id: e.id,
    title: e.summary,
    start: e.start.dateTime ?? e.start.date,
    end: e.end.dateTime ?? e.end.date,
    location: e.location,
    description: e.description?.slice(0, 300),
  };
}

function confirmationFor(args: ToolArgs): string | null {
  if (args.action !== "delete") return null;
  return `Delete calendar event${args.title ? ` "${args.title}"` : ""} (id ${args.id})`;
}

export const calendarTools: VectorTool[] = [
  {
    name: "calendar",
    description: `The user's Google Calendar. Times are local (${TIME_ZONE}) as YYYY-MM-DDTHH:mm; for all-day events use YYYY-MM-DD with all_day true. List before update/delete to get the event id.`,
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "create", "update", "delete"] },
        from: { type: "string", description: "List window start (default now)." },
        to: { type: "string", description: "List window end (optional)." },
        id: { type: "string", description: "Event id (update/delete)." },
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        all_day: { type: "boolean" },
        location: { type: "string" },
        description: { type: "string" },
      },
      required: ["action"],
    },
    needsConfirmation: confirmationFor,
    run: async (args) => {
      requireConnected();
      const allDay = args.all_day === true;
      switch (args.action) {
        case "list": {
          const from = args.from ? new Date(args.from).toISOString() : undefined;
          const to = args.to ? new Date(args.to).toISOString() : undefined;
          return (await listEvents(25, from, to)).map(brief);
        }
        case "create": {
          if (!args.title) throw new ToolError("title is required");
          const event = await createEvent({
            summary: args.title,
            description: args.description,
            location: args.location,
            start: toBoundary(args.start, allDay),
            end: toBoundary(args.end ?? args.start, allDay),
          });
          return { created: brief(event) };
        }
        case "update": {
          if (!args.id) throw new ToolError("id is required");
          const event = await updateEvent(args.id, {
            summary: args.title,
            description: args.description,
            location: args.location,
            start: args.start ? toBoundary(args.start, allDay) : undefined,
            end: args.end ? toBoundary(args.end, allDay) : undefined,
          } as Partial<CalendarEventInput>);
          return { updated: brief(event) };
        }
        case "delete": {
          if (!args.id) throw new ToolError("id is required");
          await deleteEvent(args.id);
          return { message: "The event has been removed from your calendar." };
        }
        default:
          throw new ToolError(`Unknown action: ${args.action}`);
      }
    },
  },
];
