export type VectorStatus =
  | "standby"
  | "listening"
  | "thinking"
  | "processing"
  | "speaking"
  | "private";

export interface WeatherData {
  location: string;
  temperature: number;
  condition: string;
  high: number;
  low: number;
  humidity: number;
  wind: number;
  icon: string;
}

export interface CalendarEvent {
  id: string;
  time: string;
  title: string;
  color: string;
}

export interface GoogleCalendarEvent {
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

export interface CalendarEventFormData {
  summary: string;
  description: string;
  location: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface TokenUsage {
  used: number;
  limit: number;
  label: string;
}

export interface ContextUsage {
  used: number;
  limit: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const STATUS_LABELS: Record<VectorStatus, string> = {
  standby: "STANDBY MODE",
  listening: "LISTENING",
  thinking: "THINKING",
  processing: "PROCESSING",
  speaking: "SPEAKING",
  private: "PRIVATE MODE",
};
