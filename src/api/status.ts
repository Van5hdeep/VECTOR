// Small API clients for the dashboard cards and memory list.

export interface Reminder {
  id: number;
  message: string;
  dueAt: number;
  repeat: "none" | "daily" | "weekdays" | "weekly";
}

export async function getReminders(): Promise<Reminder[]> {
  const res = await fetch("/api/reminders");
  if (!res.ok) throw new Error("Failed to load reminders.");
  return (await res.json()).reminders;
}

export async function cancelReminder(id: number): Promise<void> {
  await fetch(`/api/reminders/${id}`, { method: "DELETE" });
}

export type ConnectionState = "connected" | "expired" | "disconnected" | "not_granted" | "disabled";

export interface SystemStatus {
  model: string;
  utilityModel: string;
  sessionTokensUsed: number;
  contextLimit: number;
  calendar: ConnectionState;
  gmail: ConnectionState;
  webSearch: string;
  voice: string;
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const res = await fetch("/api/system/status");
  if (!res.ok) throw new Error("Failed to load system status.");
  return res.json();
}

export interface Memory {
  id: number;
  content: string;
  category: string;
  updated_at: number;
}

export async function getMemories(): Promise<Memory[]> {
  const res = await fetch("/api/memories");
  if (!res.ok) throw new Error("Failed to load memories.");
  return (await res.json()).memories;
}

export async function deleteMemory(id: number): Promise<void> {
  await fetch(`/api/memories/${id}`, { method: "DELETE" });
}
