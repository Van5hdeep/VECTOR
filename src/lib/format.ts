// Date/time formatting shared by the cards and chat.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatClock(d: Date): { hm: string; s: string } {
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return { hm, s: String(d.getSeconds()).padStart(2, "0") };
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayLong(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** "in 4 min", "in 2 h", "tomorrow 09:00", "Mon 12 Oct 09:00" */
export function formatDue(ms: number, now = Date.now()): string {
  const diff = ms - now;
  if (diff < MIN) return "now";
  if (diff < HOUR) return `in ${Math.round(diff / MIN)} min`;
  const due = new Date(ms);
  const today = new Date(now);
  const tomorrow = new Date(now + DAY);
  if (due.toDateString() === today.toDateString()) return `today ${formatTime(due)}`;
  if (due.toDateString() === tomorrow.toDateString()) return `tomorrow ${formatTime(due)}`;
  return due.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + ` ${formatTime(due)}`;
}

/** "just now", "3 min ago", "2 h ago" */
export function formatAgo(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Sidebar grouping for conversations */
export function recencyGroup(ms: number, now = Date.now()): "Today" | "Yesterday" | "Previous 7 days" | "Older" {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const t0 = startOfToday.getTime();
  if (ms >= t0) return "Today";
  if (ms >= t0 - DAY) return "Yesterday";
  if (ms >= t0 - 7 * DAY) return "Previous 7 days";
  return "Older";
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
