import type { ChatMessage } from "../types/vector";

export interface ConversationSnapshot {
  conversation: { id: number; title: string } | null;
  messages: ChatMessage[];
}

/**
 * Fetch the most recent conversation so VECTOR resumes where Sir left off.
 */
export async function getLatestConversation(): Promise<ConversationSnapshot> {
  const res = await fetch("/api/conversations/latest");
  if (!res.ok) throw new Error("Failed to load conversation history.");
  return res.json();
}
