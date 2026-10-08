export interface PendingAction {
  id: string;
  tool: string;
  summary: string;
}

export interface ActionOutcome {
  ok: boolean;
  message: string;
  conversationId: number | null;
}

/** Actions awaiting Sir's approval for a conversation. */
export async function getPendingActions(conversationId: number): Promise<PendingAction[]> {
  const res = await fetch(`/api/actions/pending?conversationId=${conversationId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.actions;
}

/** Approve or deny a pending action from its confirmation card. */
export async function resolvePendingAction(id: string, approve: boolean): Promise<ActionOutcome> {
  const res = await fetch(`/api/actions/${encodeURIComponent(id)}/${approve ? "approve" : "deny"}`, { method: "POST" });
  if (!res.ok) {
    return { ok: false, message: "I couldn't reach VECTOR_CORE to complete that, sir.", conversationId: null };
  }
  return res.json();
}
