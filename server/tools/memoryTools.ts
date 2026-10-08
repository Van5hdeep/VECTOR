import { addMemory, updateMemory, deleteMemory, searchMessages } from "../db.js";
import type { VectorTool } from "./types.js";
import { ToolError } from "./types.js";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export const memoryTools: VectorTool[] = [
  {
    name: "remember",
    description: "Store a durable fact about Sir in long-term memory (preferences, personal details, people, projects, goals, routines). Write it as a standalone third-person statement, e.g. 'Sir prefers tea over coffee.' Do not store transient chit-chat.",
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
      const fact = String(args.fact ?? "").trim();
      if (!fact) throw new ToolError("fact is required");
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
    run: (args) => ({ updated: updateMemory(Number(args.id), String(args.fact ?? "").trim()) }),
  },
  {
    name: "forget",
    description: "Delete a long-term memory by its id when Sir asks you to forget it or it is no longer true.",
    parameters: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    },
    run: (args) => ({ deleted: deleteMemory(Number(args.id)) }),
  },
  {
    name: "search_conversations",
    description: "Full-text search across all past conversations with Sir. Use keywords, not full sentences.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    run: (args) =>
      searchMessages(String(args.query ?? "")).map((r) => ({
        conversation: r.title,
        date: formatDate(r.created_at),
        speaker: r.role === "user" ? "Sir" : "VECTOR",
        content: r.content.slice(0, 500),
      })),
  },
];
