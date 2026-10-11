import { useEffect, useMemo, useState } from "react";
import type { ConversationSummary } from "../../api/conversations";
import { getMemories, deleteMemory, type Memory } from "../../api/status";
import { formatAgo, recencyGroup } from "../../lib/format";
import Icon from "../ui/Icon";

interface ChatSidebarProps {
  conversations: ConversationSummary[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onRename: (id: number, title: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"] as const;

export default function ChatSidebar({ conversations, activeId, onSelect, onNew, onRename, onDelete }: ChatSidebarProps) {
  const [tab, setTab] = useState<"chats" | "memory">("chats");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [memories, setMemories] = useState<Memory[] | null>(null);

  useEffect(() => {
    if (tab === "memory") getMemories().then(setMemories).catch(() => setMemories([]));
  }, [tab]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
    const map = new Map<string, ConversationSummary[]>();
    for (const c of filtered) {
      const g = recencyGroup(c.updatedAt);
      map.set(g, [...(map.get(g) ?? []), c]);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ name: g, items: map.get(g)! }));
  }, [conversations, query]);

  const commitRename = async () => {
    if (editingId !== null && editTitle.trim()) await onRename(editingId, editTitle.trim());
    setEditingId(null);
  };

  return (
    <aside className="chat-side">
      <button className="btn btn--primary chat-side__new" onClick={onNew}>
        <Icon name="plus" size={16} /> New chat
      </button>

      <div className="chat-side__tabs" role="tablist">
        <button role="tab" aria-selected={tab === "chats"} className={tab === "chats" ? "is-active" : ""} onClick={() => setTab("chats")}>
          <Icon name="chat" size={15} /> Chats
        </button>
        <button role="tab" aria-selected={tab === "memory"} className={tab === "memory" ? "is-active" : ""} onClick={() => setTab("memory")}>
          <Icon name="memory" size={15} /> Memory
        </button>
      </div>

      {tab === "chats" ? (
        <>
          <label className="chat-side__search">
            <Icon name="search" size={15} />
            <input placeholder="Search chats" aria-label="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>

          <nav className="chat-side__list" aria-label="Conversations">
            {groups.length === 0 && <p className="chat-side__empty">{query ? "No chats match that." : "Your conversations with VECTOR will appear here."}</p>}
            {groups.map((group) => (
              <section key={group.name}>
                <h3 className="chat-side__group">{group.name}</h3>
                <ul>
                  {group.items.map((c) => (
                    <li key={c.id} className={`chat-side__item ${c.id === activeId ? "is-active" : ""}`}>
                      {editingId === c.id ? (
                        <input
                          className="field chat-side__rename"
                          value={editTitle}
                          autoFocus
                          aria-label="Conversation title"
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitRename();
                            if (e.key === "Escape") { e.stopPropagation(); setEditingId(null); }
                          }}
                        />
                      ) : confirmId === c.id ? (
                        <div className="chat-side__confirm">
                          <span>Delete this chat?</span>
                          <button className="btn btn--danger" onClick={() => { setConfirmId(null); void onDelete(c.id); }}>Delete</button>
                          <button className="btn btn--ghost" onClick={() => setConfirmId(null)}>Keep</button>
                        </div>
                      ) : (
                        <>
                          <button className="chat-side__open" onClick={() => onSelect(c.id)} title={c.title}>
                            <span className="chat-side__title">{c.title}</span>
                            <span className="chat-side__time">{formatAgo(c.updatedAt)}</span>
                          </button>
                          <span className="chat-side__tools">
                            <button className="icon-btn" onClick={() => { setEditingId(c.id); setEditTitle(c.title); }} aria-label={`Rename ${c.title}`}>
                              <Icon name="edit" size={14} />
                            </button>
                            <button className="icon-btn" onClick={() => setConfirmId(c.id)} aria-label={`Delete ${c.title}`}>
                              <Icon name="trash" size={14} />
                            </button>
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
        </>
      ) : (
        <div className="chat-side__list chat-side__memory">
          {memories === null ? null : memories.length === 0 ? (
            <p className="chat-side__empty">Nothing yet. VECTOR learns about you as you talk: preferences, people, projects.</p>
          ) : (
            <ul>
              {memories.map((m) => (
                <li key={m.id} className="memory-item">
                  <span className="memory-item__cat">{m.category}</span>
                  <p>{m.content}</p>
                  <button
                    className="icon-btn"
                    aria-label="Forget this"
                    title="Forget this"
                    onClick={async () => {
                      setMemories((prev) => prev?.filter((x) => x.id !== m.id) ?? null);
                      await deleteMemory(m.id);
                    }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
