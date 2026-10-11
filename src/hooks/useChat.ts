import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, TelemetryData } from "../types/vector";
import type { VectorContextState } from "../types/context";
import { sendMessage } from "../api/chat";
import {
  getLatestConversation,
  getConversation,
  listConversations,
  renameConversation,
  deleteConversation,
  type ConversationSummary,
} from "../api/conversations";
import { getPendingActions, resolvePendingAction, type PendingAction } from "../api/actions";

export interface UseChat {
  conversations: ConversationSummary[];
  activeId: number | null;
  activeTitle: string;
  messages: ChatMessage[];
  pendingActions: PendingAction[];
  isStreaming: boolean;
  telemetry: TelemetryData | null;
  /** Send a message; resolves with VECTOR's full reply (used for speech) */
  send: (text: string, opts?: { isVoice?: boolean }) => Promise<string>;
  stop: () => void;
  newConversation: () => void;
  openConversation: (id: number) => Promise<void>;
  resumeLatest: () => Promise<void>;
  rename: (id: number, title: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  resolveAction: (id: string, approve: boolean) => Promise<string>;
  refreshList: () => Promise<void>;
  /** Live events from the server */
  applyTitle: (id: number, title: string) => void;
  appendReminder: (conversationId: number | null, text: string) => boolean;
}

export function useChat(getContext: () => VectorContextState | undefined): UseChat {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);

  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;
  const abortRef = useRef<AbortController | null>(null);
  const turnRef = useRef(0);

  const refreshList = useCallback(async () => {
    try {
      setConversations(await listConversations());
    } catch {
      // keep the current list
    }
  }, []);

  const load = useCallback(async (snapshotPromise: ReturnType<typeof getConversation>) => {
    const { conversation, messages: history } = await snapshotPromise;
    setActiveId(conversation?.id ?? null);
    setMessages(history);
    setPendingActions(conversation ? await getPendingActions(conversation.id) : []);
  }, []);

  const resumeLatest = useCallback(async () => {
    await Promise.all([load(getLatestConversation()), refreshList()]);
  }, [load, refreshList]);

  const openConversation = useCallback(async (id: number) => {
    abortRef.current?.abort();
    turnRef.current += 1;
    setIsStreaming(false);
    await load(getConversation(id));
  }, [load]);

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    turnRef.current += 1;
    setIsStreaming(false);
    setActiveId(null);
    setMessages([]);
    setPendingActions([]);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async (text: string, opts?: { isVoice?: boolean }) => {
    const trimmed = text.trim();
    if (!trimmed) return "";

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const turn = ++turnRef.current;

    setMessages((prev) => [...prev, { role: "user", content: trimmed }, { role: "assistant", content: "", tools: [] }]);
    setIsStreaming(true);

    let reply = "";
    const updateLast = (patch: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => {
        if (turnRef.current !== turn || prev.length === 0) return prev;
        const next = [...prev];
        next[next.length - 1] = patch(next[next.length - 1]);
        return next;
      });

    try {
      await sendMessage(
        trimmed,
        activeIdRef.current,
        !!opts?.isVoice,
        (chunk) => {
          reply += chunk;
          updateLast((m) => ({ ...m, content: reply }));
        },
        (t) => setTelemetry(t),
        getContext(),
        {
          signal: controller.signal,
          onConversation: (id) => {
            if (turnRef.current !== turn) return;
            if (activeIdRef.current !== id) {
              setActiveId(id);
              activeIdRef.current = id;
            }
          },
          onTool: (name, detail) => updateLast((m) => ({ ...m, tools: [...(m.tools ?? []), { name, detail }] })),
          onConfirm: (action) => setPendingActions((prev) => [...prev, action]),
          onActionResolved: (id) => setPendingActions((prev) => prev.filter((a) => a.id !== id)),
        }
      );
    } finally {
      if (turnRef.current === turn) {
        setIsStreaming(false);
        // An empty bubble after Stop or an error is noise
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          return last?.role === "assistant" && !last.content.trim() && !last.tools?.length ? prev.slice(0, -1) : prev;
        });
        void refreshList();
      }
    }
    return reply;
  }, [getContext, refreshList]);

  const resolveAction = useCallback(async (id: string, approve: boolean) => {
    setPendingActions((prev) => prev.filter((a) => a.id !== id));
    const outcome = await resolvePendingAction(id, approve);
    setMessages((prev) => [...prev, { role: "assistant", content: outcome.message, kind: "outcome" }]);
    return outcome.message;
  }, []);

  const rename = useCallback(async (id: number, title: string) => {
    await renameConversation(id, title);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  const remove = useCallback(async (id: number) => {
    await deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeIdRef.current === id) newConversation();
  }, [newConversation]);

  const applyTitle = useCallback((id: number, title: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  const appendReminder = useCallback((conversationId: number | null, text: string) => {
    if (conversationId === null || conversationId !== activeIdRef.current) return false;
    setMessages((prev) => [...prev, { role: "assistant", content: text, kind: "reminder" }]);
    return true;
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Until VECTOR names it, show the user's opening line
  const firstLine = messages.find((m) => m.role === "user")?.content.replace(/\s+/g, " ").slice(0, 60);
  const activeTitle = conversations.find((c) => c.id === activeId)?.title ?? firstLine ?? "New conversation";

  return {
    conversations,
    activeId,
    activeTitle,
    messages,
    pendingActions,
    isStreaming,
    telemetry,
    send,
    stop,
    newConversation,
    openConversation,
    resumeLatest,
    rename,
    remove,
    resolveAction,
    refreshList,
    applyTitle,
    appendReminder,
  };
}
