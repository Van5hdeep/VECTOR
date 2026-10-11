import type { ChatMessage } from "../types/vector";

export interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: number;
}

export interface ConversationSnapshot {
  conversation: { id: number; title: string } | null;
  messages: ChatMessage[];
}

/** Most recent conversation, so VECTOR resumes where the user left off. */
export async function getLatestConversation(): Promise<ConversationSnapshot> {
  const res = await fetch("/api/conversations/latest");
  if (!res.ok) throw new Error("Failed to load conversation history.");
  return res.json();
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await fetch("/api/conversations");
  if (!res.ok) throw new Error("Failed to load conversations.");
  return (await res.json()).conversations;
}

export async function getConversation(id: number): Promise<ConversationSnapshot> {
  const res = await fetch(`/api/conversations/${id}`);
  if (!res.ok) throw new Error("Failed to load conversation.");
  return res.json();
}

export async function renameConversation(id: number, title: string): Promise<void> {
  const res = await fetch(`/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to rename conversation.");
}

export async function deleteConversation(id: number): Promise<void> {
  const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete conversation.");
}
