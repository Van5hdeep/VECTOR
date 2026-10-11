import { addMemory, updateMemory, deleteMemory, listMemories, searchMessages } from "../db.js";
import { findNearDuplicate } from "../memory.js";
import { findSensitive } from "../redact.js";
import type { VectorTool } from "./types.js";
import { ToolError } from "./types.js";

const MIN_FACT_CHARS = 8;
const MAX_FACT_CHARS = 300;

/**
 * Memory is replayed into every prompt, so only short, durable, non-secret
 * statements get in. The error text is what the model sees and relays.
 */
function checkedFact(raw: unknown): string {
  const fact = String(raw ?? "").trim();
  if (!fact) throw new ToolError("fact is required");
  if (fact.length < MIN_FACT_CHARS) throw new ToolError("That is too short to be a useful memory. Write a full standalone statement.");
  if (fact.length > MAX_FACT_CHARS) {
    throw new ToolError(`That is too long for one memory (${MAX_FACT_CHARS} characters max). Store the key fact only.`);
  }
  const sensitive = findSensitive(fact);
  if (sensitive.length > 0) {
    throw new ToolError(
      `Not stored: this looks like a ${sensitive.join(" / ")}. Credentials and identifiers must never be kept in memory. Tell the user you declined and why.`
    );
  }
  return fact;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export const memoryTools: VectorTool[] = [
  {
    name: "remember",
    description: "Store a durable fact about the user in long-term memory (preferences, personal details, people, projects, goals, routines). Write it as a standalone third-person statement, e.g. 'The user prefers tea over coffee.' Do not store transient chit-chat.",
    parameters: {
      type: "object",
      properties: {
        fact: { type: "string", description: "The fact to remember." },
        category: {
          type: "string",
          enum: ["personal", "preference", "people", "work", "projects", "routine", "general"],
        },
      },
      required: ["fact"],
    },
    run: (args) => {
      const fact = checkedFact(args.fact);
      const duplicate = findNearDuplicate(fact, listMemories());
      if (duplicate) {
        return {
          stored: false,
          duplicate_of: duplicate.id,
          note: "Already known. If the fact has changed, use update_memory with that id instead.",
        };
      }
      const memory = addMemory(fact, typeof args.category === "string" ? args.category : "general");
      return { stored: true, id: memory.id };
    },
  },
  {
    name: "update_memory",
    description: "Correct or replace an existing long-term memory by its id (shown as [#id]).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "integer" },
        fact: { type: "string", description: "The corrected fact." },
      },
      required: ["id", "fact"],
    },
    run: (args) => ({ updated: updateMemory(Number(args.id), checkedFact(args.fact)) }),
  },
  {
    name: "forget",
    description: "Delete a long-term memory by its id when the user asks you to forget it or it is no longer true.",
    parameters: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    },
    run: (args) => ({ deleted: deleteMemory(Number(args.id)) }),
  },
  {
    name: "search_conversations",
    description: "Full-text search across all past conversations with the user. Use keywords, not full sentences.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    run: (args) =>
      searchMessages(String(args.query ?? "")).map((r) => ({
        conversation: r.title,
        date: formatDate(r.created_at),
        speaker: r.role === "user" ? "User" : "VECTOR",
        content: r.content.slice(0, 500),
      })),
  },
];
