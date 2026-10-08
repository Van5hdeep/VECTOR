import type Groq from "groq-sdk";
import {
  getMessages,
  listConversations,
  listMemories,
  setConversationSummary,
  type ConversationRow,
  type MessageRow,
} from "./db.js";

type ChatMessageParam = Groq.Chat.ChatCompletionMessageParam;

// ─── Context Window ──────────────────────────────────────────

// Roughly 4 characters per token; keeps recent history around ~8K tokens.
const RECENT_CHAR_BUDGET = 32_000;
const RECENT_MAX_MESSAGES = 40;
// Once this many messages have fallen out of the recent window, fold them into the summary.
const SUMMARIZE_THRESHOLD = 6;

/** Picks the newest messages that fit the budget, oldest first. */
function selectRecent(messages: MessageRow[]): MessageRow[] {
  const recent: MessageRow[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (recent.length >= RECENT_MAX_MESSAGES || chars + m.content.length > RECENT_CHAR_BUDGET) break;
    recent.unshift(m);
    chars += m.content.length;
  }
  return recent;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/** Long-term profile of Sir, injected into every request. */
export function buildMemoryContext(currentConversationId: number): string {
  const memories = listMemories();
  const memoryBlock = memories.length
    ? memories.map((m) => `- [#${m.id}] (${m.category}) ${m.content}`).join("\n")
    : "(No stored memories yet.)";

  const others = listConversations(6).filter((c) => c.id !== currentConversationId).slice(0, 5);
  const historyBlock = others.length
    ? others.map((c) => `- ${formatDate(c.updated_at)}: ${c.title}${c.summary ? ` — ${c.summary.slice(0, 300)}` : ""}`).join("\n")
    : "(No previous conversations.)";

  return `[LONG-TERM MEMORY — what you know about Sir]
${memoryBlock}

[RECENT PAST CONVERSATIONS]
${historyBlock}

Use search_conversations when Sir refers to something discussed before that is not in the current context.`;
}

/** History for the current conversation: rolling summary plus recent turns. */
export function buildConversationHistory(conversation: ConversationRow): ChatMessageParam[] {
  const all = getMessages(conversation.id);
  const recent = selectRecent(all);
  const history: ChatMessageParam[] = [];

  if (conversation.summary) {
    history.push({
      role: "system",
      content: `[SUMMARY OF EARLIER PART OF THIS CONVERSATION]\n${conversation.summary}`,
    });
  }
  for (const m of recent) {
    history.push({ role: m.role, content: m.content });
  }
  return history;
}

/**
 * Folds messages that have scrolled out of the recent window into the
 * conversation's rolling summary. Runs in the background after a reply.
 */
export async function maybeSummarize(groq: Groq, model: string, conversation: ConversationRow): Promise<void> {
  const all = getMessages(conversation.id);
  const recent = selectRecent(all);
  const firstRecentId = recent[0]?.id ?? Infinity;
  const overflow = all.filter((m) => m.id > conversation.summarized_upto && m.id < firstRecentId);
  if (overflow.length < SUMMARIZE_THRESHOLD) return;

  const transcript = overflow.map((m) => `${m.role === "user" ? "Sir" : "VECTOR"}: ${m.content}`).join("\n\n");
  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 600,
    messages: [
      {
        role: "system",
        content: "You maintain a running summary of a conversation between Sir and his assistant VECTOR. Merge the previous summary with the new transcript into one concise summary (max ~250 words). Keep decisions, facts, open tasks, names, numbers and preferences. Drop small talk. Output only the summary.",
      },
      {
        role: "user",
        content: `PREVIOUS SUMMARY:\n${conversation.summary || "(none)"}\n\nNEW TRANSCRIPT:\n${transcript}`,
      },
    ],
  });
  const summary = completion.choices[0]?.message?.content?.trim();
  if (summary) {
    setConversationSummary(conversation.id, summary, overflow[overflow.length - 1].id);
  }
}

