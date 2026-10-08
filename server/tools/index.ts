import crypto from "node:crypto";
import type Groq from "groq-sdk";
import {
  insertPendingAction,
  getPendingAction,
  resolvePendingAction,
} from "../db.js";
import type { ToolArgs, ToolContext, VectorTool } from "./types.js";
import { ToolError } from "./types.js";
import { memoryTools } from "./memoryTools.js";
import { systemTools } from "./systemTools.js";
import { fileTools } from "./fileTools.js";
import { reminderTools } from "./reminderTools.js";
import { calendarTools } from "./calendarTools.js";
import { emailTools } from "./emailTools.js";
import { webTools } from "./webTools.js";

const TOOLS: VectorTool[] = [
  ...memoryTools,
  ...systemTools,
  ...fileTools,
  ...reminderTools,
  ...calendarTools,
  ...emailTools,
  ...webTools,
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export const GROQ_TOOLS: Groq.Chat.ChatCompletionTool[] = TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

export interface ConfirmationRequest {
  id: string;
  tool: string;
  summary: string;
}

export interface ToolOutcome {
  /** What the model sees as the tool result */
  result: unknown;
  /** Set when the call was held back for Sir's approval */
  confirmation?: ConfirmationRequest;
}

function errorMessage(err: unknown): string {
  if (err instanceof ToolError) return err.message;
  console.error("[VECTOR_TOOLS] Unexpected tool failure:", err);
  return `Tool failed: ${(err as Error)?.message || String(err)}`;
}

/**
 * Executes a model-requested tool call. Sensitive calls are not executed:
 * they are parked as pending actions that only Sir can approve.
 */
export async function executeToolCall(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolOutcome> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return { result: { error: `Unknown tool: ${name}` } };

  let args: ToolArgs;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { result: { error: "Arguments were not valid JSON." } };
  }

  try {
    const summary = tool.needsConfirmation ? await tool.needsConfirmation(args) : null;
    if (summary) {
      const id = crypto.randomBytes(8).toString("hex");
      insertPendingAction(id, ctx.conversationId, name, args, summary);
      return {
        result: {
          status: "awaiting_confirmation",
          summary,
          note: "NOT executed yet. A confirmation card is now shown to Sir. In one short sentence, tell him what you are about to do and ask whether to proceed. Do not claim it is done.",
        },
        confirmation: { id, tool: name, summary },
      };
    }
    return { result: await tool.run(args, ctx) };
  } catch (err) {
    return { result: { error: errorMessage(err) } };
  }
}

export interface ResolvedAction {
  ok: boolean;
  /** Short spoken/written outcome in VECTOR's voice */
  message: string;
  conversationId: number | null;
}

/** Runs (approve) or discards (deny) a pending action. Only reachable from Sir's own input. */
export async function resolveAction(id: string, approve: boolean): Promise<ResolvedAction> {
  const action = getPendingAction(id);
  if (!action || !resolvePendingAction(id, approve ? "approved" : "denied")) {
    return { ok: false, message: "That request has already been handled or has expired, sir.", conversationId: null };
  }
  if (!approve) {
    return { ok: true, message: "Understood, sir. I've cancelled that.", conversationId: action.conversation_id };
  }

  const tool = TOOLS_BY_NAME.get(action.tool);
  if (!tool) return { ok: false, message: "That action is no longer available, sir.", conversationId: action.conversation_id };

  try {
    const result = await tool.run(JSON.parse(action.args), { conversationId: action.conversation_id });
    const detail = result && typeof result === "object" && "message" in result ? ` ${(result as { message: string }).message}` : "";
    return { ok: true, message: `Done, sir.${detail}`, conversationId: action.conversation_id };
  } catch (err) {
    return { ok: false, message: `I'm afraid that failed, sir: ${errorMessage(err)}`, conversationId: action.conversation_id };
  }
}

const AFFIRMATIVE = /^(yes|yeah|yep|yup|sure|confirm(ed)?|approved?|proceed|go ahead|do it|send it|delete it|make it so)( please)?([,.!\s]+(sir|vector|please|go ahead|do it|proceed))*[.!\s]*$/i;
const NEGATIVE = /^(no|nope|cancel( it)?|stop|abort|don'?t|do not|never ?mind|hold off)( please)?([,.!\s]+(sir|vector|please|cancel( it)?|don'?t))*[.!\s]*$/i;

/** Recognises a plain yes/no reply to a pending confirmation (typed or spoken). */
export function classifyConfirmationReply(message: string): "approve" | "deny" | null {
  const text = message.trim();
  if (AFFIRMATIVE.test(text)) return "approve";
  if (NEGATIVE.test(text)) return "deny";
  return null;
}
