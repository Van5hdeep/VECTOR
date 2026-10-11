import type Groq from "groq-sdk";
import {
  getMessages,
  listConversations,
  listMemories,
  setConversationSummary,
  setConversationTitle,
  type ConversationRow,
  type MemoryRow,
  type MessageRow,
} from "./db.js";
import { redactSensitive } from "./redact.js";

type ChatMessageParam = Groq.Chat.ChatCompletionMessageParam;

// Supported by Groq's API for gpt-oss models but not yet in the SDK's types.
const LOW_REASONING = { reasoning_effort: "low" } as object;

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

// ─── Memory Matching ─────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "is", "are", "was", "were",
  "be", "been", "his", "her", "their", "its", "this", "that", "user", "users", "my", "me", "i", "you", "it",
  "has", "have", "had", "as", "by", "from", "about", "so", "but", "not", "do", "does", "did", "will", "would",
]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/** An existing memory that says (nearly) the same thing, so the same fact isn't stored twice. */
export function findNearDuplicate(fact: string, memories: MemoryRow[]): MemoryRow | undefined {
  const words = keywords(fact);
  return memories.find((m) => jaccard(words, keywords(m.content)) >= 0.7);
}

// ~750 tokens. Under this, every memory is injected; over it, only the relevant ones.
const MEMORY_CHAR_BUDGET = 3_000;

function formatMemory(m: MemoryRow): string {
  return `- [#${m.id}] (${m.category}) ${redactSensitive(m.content)}`;
}

/**
 * Picks the memories to inject. Everything fits until the budget is reached;
 * after that, memories that share words with the user's message come first,
 * then the most recently updated.
 */
function selectMemories(memories: MemoryRow[], query: string): { shown: MemoryRow[]; omitted: number } {
  const lines = memories.map(formatMemory);
  if (lines.reduce((n, l) => n + l.length + 1, 0) <= MEMORY_CHAR_BUDGET) {
    return { shown: memories, omitted: 0 };
  }
  const queryWords = keywords(query);
  const ranked = memories
    .map((m, recency) => {
      let overlap = 0;
      for (const w of keywords(m.content)) if (queryWords.has(w)) overlap++;
      return { m, overlap, recency }; // listMemories() is newest-first, so lower recency = newer
    })
    .sort((a, b) => b.overlap - a.overlap || a.recency - b.recency);

  const shown: MemoryRow[] = [];
  let chars = 0;
  for (const { m } of ranked) {
    const len = formatMemory(m).length + 1;
    if (chars + len > MEMORY_CHAR_BUDGET) continue;
    shown.push(m);
    chars += len;
  }
  shown.sort((a, b) => b.updated_at - a.updated_at);
  return { shown, omitted: memories.length - shown.length };
}

/** Long-term profile of the user, injected into every request. */
export function buildMemoryContext(currentConversationId: number, userMessage = ""): string {
  const { shown, omitted } = selectMemories(listMemories(), userMessage);
  const memoryBlock = shown.length
    ? shown.map(formatMemory).join("\n") +
      (omitted ? `\n(${omitted} other stored memories are not shown; they appear when relevant to what the user says.)` : "")
    : "(No stored memories yet.)";

  const others = listConversations(6).filter((c) => c.id !== currentConversationId).slice(0, 5);
  const historyBlock = others.length
    ? others.map((c) => `- ${formatDate(c.updated_at)}: ${c.title}${c.summary ? ` — ${c.summary.slice(0, 300)}` : ""}`).join("\n")
    : "(No previous conversations.)";

  return `[LONG-TERM MEMORY — what you know about the user]
${memoryBlock}

[RECENT PAST CONVERSATIONS]
${historyBlock}

Use search_conversations when the user refers to something discussed before that is not in the current context.`;
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

  const transcript = overflow.map((m) => `${m.role === "user" ? "User" : "VECTOR"}: ${m.content}`).join("\n\n");
  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 700,
    ...LOW_REASONING,
    messages: [
      {
        role: "system",
        content: "You maintain a running summary of a conversation between the user and their assistant VECTOR. Merge the previous summary with the new transcript into one concise summary (max ~250 words). Keep decisions, facts, open tasks, names, numbers and preferences. Drop small talk. Output only the summary.",
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


/** VECTOR names a conversation after its first exchange (utility model, a few tokens). */
export async function generateTitle(groq: Groq, model: string, conversationId: number): Promise<string | null> {
  const [first, second] = getMessages(conversationId);
  if (!first) return null;
  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 120, // reasoning models spend a few tokens thinking first
    ...LOW_REASONING,
    messages: [
      {
        role: "system",
        content: "Name this conversation in 2 to 6 words, Title Case, no quotes, no trailing punctuation. Output only the title.",
      },
      {
        role: "user",
        content: `User: ${first.content.slice(0, 500)}\nVECTOR: ${(second?.content ?? "").slice(0, 300)}`,
      },
    ],
  });
  const title = completion.choices[0]?.message?.content
    ?.replace(/^["'\s]+|["'.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .split(" ")
    .slice(0, 6) // models overrun the word limit; enforce it
    .join(" ")
    .replace(/[,:;–—-]+$/, "")
    .slice(0, 60);
  if (!title) return null;
  setConversationTitle(conversationId, title);
  return title;
}
