import { useEffect, useRef } from "react";
import type { ChatMessage, ToolActivity } from "../../types/vector";
import type { PendingAction } from "../../api/actions";
import MessageView from "./MessageView";
import Icon from "../ui/Icon";

interface ChatThreadProps {
  messages: ChatMessage[];
  pendingActions: PendingAction[];
  isStreaming: boolean;
  onResolveAction: (id: string, approve: boolean) => void;
  onSuggestion: (text: string) => void;
}

const TOOL_LABELS: Record<string, string> = {
  web_search: "Searching the web",
  fetch_webpage: "Reading a page",
  open: "Opening",
  files: "Working with files",
  reminders: "Reminders",
  calendar: "Calendar",
  email: "Gmail",
  remember: "Noted to memory",
  update_memory: "Updated memory",
  forget: "Forgot a memory",
  search_conversations: "Searching past chats",
};

const SUGGESTIONS = [
  "What's on my calendar today?",
  "Remind me in 20 minutes to stretch",
  "Search the web for today's top tech news",
  "What do you remember about me?",
];

function ToolChips({ tools, running }: { tools: ToolActivity[]; running: boolean }) {
  return (
    <ul className="tool-chips" aria-label="What VECTOR did">
      {tools.map((t, i) => {
        const active = running && i === tools.length - 1;
        return (
          <li key={i} className={`tool-chip ${active ? "tool-chip--active" : ""}`}>
            {!active && <Icon name="check" size={13} />}
            <span>{TOOL_LABELS[t.name] ?? t.name}</span>
            {t.detail && <span className="tool-chip__detail">{t.detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default function ChatThread({ messages, pendingActions, isStreaming, onResolveAction, onSuggestion }: ChatThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Follow the stream unless the user scrolled up to read
  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pendingActions]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  if (messages.length === 0) {
    return (
      <div className="thread thread--empty">
        <h2 className="thread__hello">How may I assist you?</h2>
        <div className="thread__suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="suggestion" onClick={() => onSuggestion(s)}>{s}</button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="thread" ref={scrollerRef} onScroll={onScroll}>
      <div className="thread__inner">
        {messages.map((m, i) => {
          const last = i === messages.length - 1;
          const streaming = last && isStreaming && m.role === "assistant";
          if (m.role === "user") {
            return (
              <div key={i} className="msg msg--sir">
                <div className="msg__bubble">{m.content}</div>
              </div>
            );
          }
          return (
            <div key={i} className={`msg msg--vector ${m.kind ? `msg--${m.kind}` : ""}`}>
              <div className="msg__body">
                {m.kind === "reminder" && <span className="msg__tag"><Icon name="bell" size={13} /> Reminder</span>}
                {m.tools && m.tools.length > 0 && <ToolChips tools={m.tools} running={streaming && !m.content} />}
                {m.content ? <MessageView content={m.content} /> : streaming && <span className="msg__thinking">Thinking<i /><i /><i /></span>}
                {streaming && m.content && <span className="msg__caret" />}
              </div>
            </div>
          );
        })}

        {pendingActions.map((action) => (
          <div key={action.id} className="approval" role="group" aria-label="Action awaiting approval">
            <span className="approval__label"><Icon name="lock" size={13} /> Needs your approval</span>
            <p className="approval__summary">{action.summary}</p>
            <div className="approval__buttons">
              <button className="btn btn--ghost" onClick={() => onResolveAction(action.id, false)}>Cancel</button>
              <button className="btn approval__go" onClick={() => onResolveAction(action.id, true)}>Proceed</button>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
