// Load .env before any module that reads configuration at import time
import "dotenv/config";
import express from "express";
import crypto from "crypto";
import Groq, { toFile } from "groq-sdk";
import type { ChatCompletionCreateParamsStreaming } from "groq-sdk/resources/chat/completions";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { VECTOR_SYSTEM_PROMPT } from "./systemPrompt.js";
import {
  getAuthStatus,
  getAuthUrl,
  handleOAuthCallback,
  disconnect,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
} from "./calendarService.js";
import {
  createConversation,
  getConversation,
  getLatestConversation,
  listConversations,
  deleteConversation,
  setConversationTitle,
  addMessage,
  getMessages,
  listMemories,
  deleteMemory,
  listWebAuthnCredentials,
  saveWebAuthnCredential,
  updateWebAuthnCounter,
  listPendingActions,
} from "./db.js";
import {
  startSession,
  endSession,
  isAuthenticated,
  requireAuth,
  requireTrustedOrigin,
  UI_ORIGIN,
  lockoutRemaining,
  recordAuthFailure,
  recordAuthSuccess,
} from "./auth.js";
import {
  buildMemoryContext,
  buildConversationHistory,
  maybeSummarize,
} from "./memory.js";
import {
  GROQ_TOOLS,
  executeToolCall,
  resolveAction,
  classifyConfirmationReply,
} from "./tools/index.js";
import { handleEventStream } from "./events.js";
import { startScheduler } from "./scheduler.js";
import { searchProvider } from "./tools/webTools.js";


const PORT = Number(process.env.VECTOR_PORT) || 3001;

const apiKey = process.env.VECTOR_CORE_API_KEY;
const model = process.env.VECTOR_CORE_MODEL;

if (!apiKey || apiKey === "your_api_key_here") {
  console.error(
    "[VECTOR_CORE] VECTOR_CORE_API_KEY is not configured. Set it in the .env file."
  );
  process.exit(1);
}

if (!model) {
  console.error(
    "[VECTOR_CORE] VECTOR_CORE_MODEL is not configured. Set it in the .env file."
  );
  process.exit(1);
}

const groq = new Groq({ apiKey });

// ═══════════════════════════════════════════════════════════
//  ElevenLabs TTS Configuration (optional — voice is not required)
// ═══════════════════════════════════════════════════════════

const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID;
const elevenLabsModel = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";

let elevenlabs: ElevenLabsClient | null = null;
if (elevenLabsApiKey && elevenLabsVoiceId) {
  elevenlabs = new ElevenLabsClient({ apiKey: elevenLabsApiKey });
  console.log("[VECTOR_CORE] ElevenLabs TTS: Configured");
} else {
  console.warn(
    "[VECTOR_CORE] ElevenLabs TTS: Not configured. Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env to enable voice."
  );
}

// ═══════════════════════════════════════════════════════════
//  Fish Audio TTS Configuration
// ═══════════════════════════════════════════════════════════

const fishAudioApiKey = process.env.FISH_AUDIO_API_KEY;
const fishAudioVoiceId = process.env.FISH_AUDIO_VOICE_ID;

if (fishAudioApiKey && fishAudioVoiceId) {
  console.log("[VECTOR_CORE] Fish Audio TTS: Configured");
} else {
  console.warn(
    "[VECTOR_CORE] Fish Audio TTS: Not configured. Set FISH_AUDIO_API_KEY and FISH_AUDIO_VOICE_ID in .env."
  );
}

let sessionTokensUsed = 0;
// Default to 131,072 for gpt-oss-120b, fallback to 100,000 otherwise
const contextLimit = model === "openai/gpt-oss-120b" ? 131072 : 100000;

const app = express();
app.use(express.json());
app.use(requireTrustedOrigin);

// Routes reachable while locked. Everything else under /api requires an owner session.
const PUBLIC_PATHS = new Set([
  "/api/auth/password",
  "/api/auth/session",
  "/api/auth/logout",
  "/api/auth/webauthn/status",
  "/api/auth/webauthn/authenticate/options",
  "/api/auth/webauthn/authenticate/verify",
  "/api/calendar/oauth/callback", // protected by the OAuth state parameter instead
]);
app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }
  requireAuth(req, res, next);
});

interface ChatRequestBody {
  message: string;
  conversationId?: number;
  isVoice?: boolean;
  clientContext?: any;
}

type ChatMessageParam = Groq.Chat.ChatCompletionMessageParam;

const MAX_TOOL_ROUNDS = 6;

// Groq's free tier allows few tokens per minute; tool turns make several calls.
// Short rate-limit waits are absorbed here instead of failing the reply.
const MAX_RATE_LIMIT_WAIT_S = 20;

async function createCompletionWithRetry(params: ChatCompletionCreateParamsStreaming) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await groq.chat.completions.create(params);
    } catch (err) {
      const retryAfter = err instanceof Groq.APIError && err.status === 429
        ? Number(err.headers?.["retry-after"] ?? 0)
        : NaN;
      if (attempt >= 2 || !(retryAfter >= 0) || retryAfter > MAX_RATE_LIMIT_WAIT_S) throw err;
      console.warn(`[VECTOR_CORE] Groq rate limit hit; retrying in ${retryAfter || 1}s`);
      await new Promise((r) => setTimeout(r, Math.max(retryAfter, 1) * 1000));
    }
  }
}

function writeSSE(res: express.Response, data: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function makeTitle(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

// Intent Recognition for Context Injection
/** Server clock (same PC as Sir), so dates are right even without client context. */
function serverTimeContext(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `[SYSTEM CONTEXT: TIME]
Now: ${now.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
Local ISO: ${local}
Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
}

function getRequiredContext(message: string, clientContext: any): string[] {
  // Time is always relevant (memory timestamps, "today", reminders) and costs few tokens.
  const injectedContexts: string[] = [serverTimeContext()];
  if (!clientContext) return injectedContexts;
  const reqLower = message.toLowerCase();

  if (reqLower.includes("session") || reqLower.includes("talking") || reqLower.includes("active")) {
    injectedContexts.push(`[SYSTEM CONTEXT: SESSION]
Voice Mode: ${clientContext.session?.voiceMode ? "Active" : "Inactive"}
Conversation State: ${clientContext.session?.conversationState}
Session Duration: ${clientContext.session?.sessionActiveDuration} seconds`);
  }

  if (reqLower.includes("weather") || reqLower.includes("forecast") || reqLower.includes("temperature") || reqLower.includes("rain") || reqLower.includes("umbrella")) {
    injectedContexts.push(`[SYSTEM CONTEXT: WEATHER]
Location: ${clientContext.location?.city} (${clientContext.location?.latitude}, ${clientContext.location?.longitude})
Condition: ${clientContext.weather?.condition}
Temperature: ${clientContext.weather?.temperature}°C
Humidity: ${clientContext.weather?.humidity}%
Wind: ${clientContext.weather?.wind} km/h`);
  }

  // Calendar, email, files etc. are reached through tools rather than injected context.
  return injectedContexts;
}

app.post("/api/chat", async (req: express.Request, res: express.Response) => {
  let conversationId: number | null = null;
  let reply = "";

  try {
    const { message, conversationId: requestedId, isVoice, clientContext } = req.body as ChatRequestBody;

    // Validate message
    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    // Resolve the conversation (history lives server-side now)
    let conversation = requestedId ? getConversation(Number(requestedId)) : undefined;
    if (!conversation) conversation = createConversation();
    conversationId = conversation.id;

    // A plain "yes"/"no" while an action awaits approval is Sir answering the confirmation
    const pending = listPendingActions(conversation.id);
    const decision = pending.length > 0 ? classifyConfirmationReply(message) : null;
    if (decision) {
      const action = pending[pending.length - 1];
      addMessage(conversation.id, "user", message.trim());
      const outcome = await resolveAction(action.id, decision === "approve");
      addMessage(conversation.id, "assistant", outcome.message);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      writeSSE(res, { conversationId: conversation.id });
      writeSSE(res, { actionResolved: action.id });
      writeSSE(res, { text: outcome.message });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // Build conversation messages: persona, long-term memory, then this conversation's history
    const messages: ChatMessageParam[] = [
      { role: "system", content: VECTOR_SYSTEM_PROMPT },
      { role: "system", content: buildMemoryContext(conversation.id) },
      ...buildConversationHistory(conversation),
    ];

    if (isVoice) {
      messages.push({
        role: "system",
        content: "The following input was spoken by the user via voice. Respond naturally as a voice assistant. Do not use text-based phrasing like 'I can see your message'. Use conversational spoken language."
      });
    }

    // Context Injection
    const requiredContexts = getRequiredContext(message, clientContext);

    if (requiredContexts.length > 0) {
      messages.push({
        role: "system",
        content: `LIVE APPLICATION CONTEXT:\n${requiredContexts.join("\n\n")}\n\nUse this actual runtime data to answer the user's request. Do not say you don't have access to this information.`
      });
    }

    // Append current user message and persist it
    const trimmed = message.trim();
    messages.push({ role: "user", content: trimmed });
    if (conversation.title === "New conversation") {
      setConversationTitle(conversation.id, makeTitle(trimmed));
    }
    addMessage(conversation.id, "user", trimmed);

    let contextTokensUsed = 0;

    // Agent loop: stream the reply; if the model calls tools, run them and continue.
    // The last round forbids tools so the turn always ends with an answer.
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const finalRound = round === MAX_TOOL_ROUNDS - 1;
      const stream = await createCompletionWithRetry({
        model: model,
        messages,
        tools: GROQ_TOOLS,
        tool_choice: finalRound ? "none" : "auto",
        temperature: 0.7,
        max_tokens: 1024,
        stream: true,
      });

      if (!res.headersSent) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ conversationId: conversation.id })}\n\n`);
      }

      let roundText = "";
      const toolCalls: { id: string; name: string; args: string }[] = [];

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const content = delta?.content || "";
        if (content) {
          roundText += content;
          res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
        }

        for (const call of delta?.tool_calls ?? []) {
          const slot = (toolCalls[call.index] ??= { id: "", name: "", args: "" });
          if (call.id) slot.id = call.id;
          if (call.function?.name) slot.name += call.function.name;
          if (call.function?.arguments) slot.args += call.function.arguments;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const usage = (chunk as any).usage || (chunk as any).x_groq?.usage;
        if (usage) {
          sessionTokensUsed += usage.total_tokens || 0;
          contextTokensUsed = usage.prompt_tokens || 0;
        }
      }

      reply += roundText;
      const calls = toolCalls.filter(Boolean);
      if (calls.length === 0) break;

      messages.push({
        role: "assistant",
        content: roundText || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: c.args || "{}" },
        })),
      });

      for (const call of calls) {
        console.log(`[VECTOR_CORE] Tool ${call.name}:`, call.args);
        writeSSE(res, { tool: call.name });
        const outcome = await executeToolCall(call.name, call.args, { conversationId: conversation.id });
        if (outcome.confirmation) {
          writeSSE(res, { confirm: outcome.confirmation });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(outcome.result) });
      }
    }

    if (reply.trim()) {
      addMessage(conversation.id, "assistant", reply);
    }

    if (contextTokensUsed > 0) {
      res.write(`data: ${JSON.stringify({ telemetry: { sessionTokensUsed, contextTokensUsed, contextLimit } })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();

    // Keep the rolling summary current without delaying the reply
    const latest = getConversation(conversation.id);
    if (latest) {
      maybeSummarize(groq, model, latest).catch((e) =>
        console.error("[VECTOR_CORE] Summarization failed:", (e as Error).message)
      );
    }
  } catch (err: unknown) {
    // Keep whatever was already said so the memory matches what Sir saw
    if (conversationId !== null && reply.trim()) {
      addMessage(conversationId, "assistant", reply);
    }

    if (!res.headersSent) {
      // Handle Groq rate limit
      if (err instanceof Groq.APIError && err.status === 429) {
        console.warn("[VECTOR_CORE] Groq rate limit:", err.message);
        res.status(429).json({
          error: "I've hit my language model's rate limit, sir. Give me a minute and try again.",
        });
        return;
      }

      // Handle other Groq API errors
      if (err instanceof Groq.APIError) {
        console.error("[VECTOR_CORE] Groq API error:", err.status, err.message);
        res.status(502).json({
          error: "I encountered an issue communicating with my language model. Please try again.",
        });
        return;
      }

      // Generic error
      console.error("[VECTOR_CORE] Unexpected error:", (err as Error).message);
      res.status(500).json({
        error: "An unexpected error occurred. Please try again.",
      });
    } else {
      console.error("[VECTOR_CORE] Streaming error:", (err as Error).message);
      res.write(`data: ${JSON.stringify({ text: "\n\n[Connection Interrupted]" })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

// ═══════════════════════════════════════════════════════════
//  Conversation & Memory Routes
// ═══════════════════════════════════════════════════════════

function toClientMessages(conversationId: number) {
  return getMessages(conversationId).map((m) => ({ role: m.role, content: m.content }));
}

/** List past conversations, newest first */
app.get("/api/conversations", (_req: express.Request, res: express.Response) => {
  res.json({
    conversations: listConversations().map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updated_at,
    })),
  });
});

/** Resume the most recent conversation (or nothing, if none exist) */
app.get("/api/conversations/latest", (_req: express.Request, res: express.Response) => {
  const latest = getLatestConversation();
  if (!latest) {
    res.json({ conversation: null, messages: [] });
    return;
  }
  res.json({
    conversation: { id: latest.id, title: latest.title },
    messages: toClientMessages(latest.id),
  });
});

app.get("/api/conversations/:id", (req: express.Request, res: express.Response) => {
  const conversation = getConversation(Number(req.params.id));
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }
  res.json({
    conversation: { id: conversation.id, title: conversation.title },
    messages: toClientMessages(conversation.id),
  });
});

app.delete("/api/conversations/:id", (req: express.Request, res: express.Response) => {
  deleteConversation(Number(req.params.id));
  res.json({ success: true });
});

/** Long-term memories VECTOR holds about Sir */
app.get("/api/memories", (_req: express.Request, res: express.Response) => {
  res.json({ memories: listMemories() });
});

app.delete("/api/memories/:id", (req: express.Request, res: express.Response) => {
  res.json({ success: deleteMemory(Number(req.params.id)) });
});

// ═══════════════════════════════════════════════════════════
//  Action Confirmation & Live Events
// ═══════════════════════════════════════════════════════════

/** Actions waiting for Sir's approval (e.g. to restore cards after a reload) */
app.get("/api/actions/pending", (req: express.Request, res: express.Response) => {
  const conversationId = req.query.conversationId ? Number(req.query.conversationId) : undefined;
  res.json({
    actions: listPendingActions(conversationId).map((a) => ({ id: a.id, tool: a.tool, summary: a.summary })),
  });
});

/** Approve or deny a pending action from its confirmation card */
app.post("/api/actions/:id/:decision", async (req: express.Request, res: express.Response) => {
  const decision = req.params.decision;
  if (decision !== "approve" && decision !== "deny") {
    res.status(404).json({ error: "Unknown decision." });
    return;
  }
  const outcome = await resolveAction(String(req.params.id), decision === "approve");
  if (outcome.conversationId !== null) {
    addMessage(outcome.conversationId, "assistant", outcome.message);
  }
  res.json(outcome);
});

/** Server → UI push channel (reminders) */
app.get("/api/events", handleEventStream);

// ═══════════════════════════════════════════════════════════
//  TTS Routes
// ═══════════════════════════════════════════════════════════

interface TTSRequestBody {
  text: string;
  provider?: string;
}

app.get("/api/tts/status", async (_req: express.Request, res: express.Response) => {
  let elevenlabsUsage = null;
  if (elevenlabs) {
    try {
      const user = await elevenlabs.user.getSubscription();
      elevenlabsUsage = {
        used: user.character_count,
        limit: user.character_limit,
        remaining: user.character_limit - user.character_count,
        unit: "characters"
      };
    } catch (e) {
      console.error("[VECTOR_CORE] ElevenLabs usage fetch error:", (e as Error).message);
    }
  }

  let fishAudioUsage = null;
  if (fishAudioApiKey) {
    try {
      const faRes = await fetch("https://api.fish.audio/wallet/self/api-credit", {
        headers: { "Authorization": `Bearer ${fishAudioApiKey}` }
      });
      if (faRes.ok) {
        const faData = await faRes.json();
        const credit = parseFloat(faData.credit || "0");
        const total = parseFloat(faData.cumulative_top_up || "0");
        fishAudioUsage = {
          used: total >= credit ? total - credit : 0,
          limit: total,
          remaining: credit,
          unit: "credits"
        };
      }
    } catch (e) {
      console.error("[VECTOR_CORE] Fish Audio usage fetch error:", (e as Error).message);
    }
  }

  res.json({
    elevenlabs: {
      configured: !!(elevenLabsApiKey && elevenLabsVoiceId),
      usage: elevenlabsUsage
    },
    fishAudio: {
      configured: !!(fishAudioApiKey && fishAudioVoiceId),
      usage: fishAudioUsage
    }
  });
});

app.post("/api/tts", async (req: express.Request, res: express.Response) => {
  try {
    const { text, provider } = req.body as TTSRequestBody;

    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "Text is required for speech synthesis." });
      return;
    }
    console.log(`[VECTOR_TTS] TTS request started, text length: ${text.length}, provider: ${provider || "elevenlabs"}`);

    if (provider === "fish-audio") {
      if (!fishAudioApiKey || !fishAudioVoiceId) {
        res.status(503).json({ error: "Fish Audio synthesis is not configured." });
        return;
      }
      
      console.log("[VECTOR_TTS] Fish Audio request sent");
      const faRes = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${fishAudioApiKey}`,
          "Content-Type": "application/json",
          "model": "s2.1-pro-free"
        },
        body: JSON.stringify({
          text: text.trim(),
          reference_id: fishAudioVoiceId,
          format: "mp3"
        })
      });
      
      if (!faRes.ok) {
        throw new Error(`Fish Audio returned ${faRes.status}: ${await faRes.text()}`);
      }
      
      console.log("[VECTOR_TTS] Fish Audio response received");
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      });
      
      if (faRes.body) {
        const reader = faRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }

    // Default to elevenlabs
    if (!elevenlabs || !elevenLabsVoiceId) {
      res.status(503).json({ error: "Voice synthesis is not configured." });
      return;
    }

    console.log("[VECTOR_TTS] ElevenLabs request sent");
    const audioStream = await elevenlabs.textToSpeech.convert(elevenLabsVoiceId, {
      text: text.trim(),
      modelId: elevenLabsModel,
      outputFormat: "mp3_22050_32",
    });
    console.log("[VECTOR_TTS] ElevenLabs response received");

    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache",
    });

    const reader = audioStream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err: any) {
    console.error("[VECTOR_CORE] TTS error:", err?.message || err);

    if (!res.headersSent) {
      res.status(502).json({
        error: "Voice synthesis failed. The text response is still available.",
      });
    } else {
      res.end();
    }
  }
});

// ═══════════════════════════════════════════════════════════
//  Groq Speech-to-Text Endpoint
// ═══════════════════════════════════════════════════════════

app.post("/api/stt", express.raw({ type: "*/*", limit: "25mb" }), async (req: express.Request, res: express.Response) => {
  try {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Audio data is required and must not be empty." });
      return;
    }

    const contentType = req.headers["content-type"] || "audio/webm";
    let extension = "webm";
    if (contentType.includes("mp4")) extension = "mp4";
    else if (contentType.includes("mp3") || contentType.includes("mpeg")) extension = "mp3";
    else if (contentType.includes("ogg")) extension = "ogg";
    else if (contentType.includes("wav")) extension = "wav";
    else if (contentType.includes("m4a")) extension = "m4a";
    else if (contentType.includes("flac")) extension = "flac";

    console.log(`[VECTOR_CORE] Received STT upload. Type: ${contentType}, Size: ${req.body.length} bytes, Ext: ${extension}`);

    const file = await toFile(req.body, `audio.${extension}`);

    const transcription = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3-turbo",
      response_format: "json",
    });

    res.json({ text: transcription.text });
  } catch (err: unknown) {
    const message = (err as Error).message || "Unknown STT error";
    console.error("[VECTOR_CORE] Groq STT error:", message);
    res.status(502).json({ error: "Failed to transcribe audio." });
  }
});

// ═══════════════════════════════════════════════════════════
//  Google Calendar API Routes
// ═══════════════════════════════════════════════════════════

/** Check whether Google Calendar is connected */
app.get("/api/calendar/status", (_req: express.Request, res: express.Response) => {
  try {
    const status = getAuthStatus();
    res.json(status);
  } catch {
    res.status(500).json({ error: "Failed to check calendar status." });
  }
});

// The callback is reached via a redirect from Google (no session cookie), so it is
// tied to the authenticated request that started the flow by a one-time state value.
let pendingOAuthState: string | null = null;

/** Generate Google OAuth authorization URL */
app.get("/api/calendar/auth", (_req: express.Request, res: express.Response) => {
  try {
    pendingOAuthState = crypto.randomBytes(16).toString("hex");
    const authUrl = getAuthUrl(pendingOAuthState);
    if (!authUrl) {
      res.status(500).json({
        error: "Google Calendar credentials not found. Place the OAuth credential JSON in server/credentials/.",
      });
      return;
    }
    res.json({ authUrl });
  } catch {
    res.status(500).json({ error: "Failed to generate authorization URL." });
  }
});

/** OAuth callback — receives authorization code from Google */
app.get("/api/calendar/oauth/callback", async (req: express.Request, res: express.Response) => {
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code) {
      res.status(400).send("Authorization code missing.");
      return;
    }
    if (!state || !pendingOAuthState || state !== pendingOAuthState) {
      res.status(400).send("Invalid or expired authorization request. Start the connection again from VECTOR.");
      return;
    }
    pendingOAuthState = null;

    await handleOAuthCallback(code);

    // Redirect back to the frontend with a success indicator
    res.redirect(`${UI_ORIGIN}/?calendar_connected=true`);
  } catch (err) {
    console.error("[VECTOR_CORE] OAuth callback error:", (err as Error).message);
    res.status(500).send("Failed to complete Google Calendar authorization.");
  }
});

/** Disconnect Google Calendar */
app.post("/api/calendar/disconnect", (_req: express.Request, res: express.Response) => {
  try {
    disconnect();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to disconnect Google Calendar." });
  }
});

/** List upcoming calendar events */
app.get("/api/calendar/events", async (_req: express.Request, res: express.Response) => {
  try {
    const events = await listEvents();
    res.json({ events });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("not connected")) {
      res.status(401).json({ error: "Google Calendar is not connected." });
      return;
    }
    console.error("[VECTOR_CORE] Calendar list error:", message);
    res.status(502).json({ error: "Failed to retrieve calendar events." });
  }
});

/** Create a new calendar event */
app.post("/api/calendar/events", async (req: express.Request, res: express.Response) => {
  try {
    const { summary, description, location, start, end } = req.body;
    if (!summary || !start || !end) {
      res.status(400).json({ error: "Event title, start, and end are required." });
      return;
    }
    const event = await createEvent({ summary, description, location, start, end });
    res.json({ event });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("not connected")) {
      res.status(401).json({ error: "Google Calendar is not connected." });
      return;
    }
    console.error("[VECTOR_CORE] Calendar create error:", message);
    res.status(502).json({ error: "Failed to create calendar event." });
  }
});

/** Update an existing calendar event */
app.patch("/api/calendar/events/:eventId", async (req: express.Request, res: express.Response) => {
  try {
    const eventId = req.params.eventId as string;
    const { summary, description, location, start, end } = req.body;
    const event = await updateEvent(eventId, { summary, description, location, start, end });
    res.json({ event });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("not connected")) {
      res.status(401).json({ error: "Google Calendar is not connected." });
      return;
    }
    console.error("[VECTOR_CORE] Calendar update error:", message);
    res.status(502).json({ error: "Failed to update calendar event." });
  }
});

/** Delete a calendar event */
app.delete("/api/calendar/events/:eventId", async (req: express.Request, res: express.Response) => {
  try {
    const eventId = req.params.eventId as string;
    await deleteEvent(eventId);
    res.json({ success: true });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("not connected")) {
      res.status(401).json({ error: "Google Calendar is not connected." });
      return;
    }
    console.error("[VECTOR_CORE] Calendar delete error:", message);
    res.status(502).json({ error: "Failed to delete calendar event." });
  }
});

// ═══════════════════════════════════════════════════════════
//  Authentication Routes (Lock Screen)
// ═══════════════════════════════════════════════════════════

// WebAuthn configuration
const rpName = "VECTOR";
const rpID = "localhost";
const origin = UI_ORIGIN;

// Single owner, single pending ceremony at a time
let currentChallenge: string | undefined;

function lockedOut(res: express.Response): boolean {
  const wait = lockoutRemaining();
  if (wait > 0) {
    res.status(429).json({ success: false, error: `Too many failed attempts. Try again in ${wait}s.` });
    return true;
  }
  return false;
}

/** Is the current browser session unlocked? */
app.get("/api/auth/session", (req: express.Request, res: express.Response) => {
  res.json({ authenticated: isAuthenticated(req) });
});

/** Lock: revoke the current session */
app.post("/api/auth/logout", (req: express.Request, res: express.Response) => {
  endSession(req, res);
  res.json({ success: true });
});

/** Password authentication */
app.post("/api/auth/password", (req: express.Request, res: express.Response) => {
  try {
    if (lockedOut(res)) return;

    const { password } = req.body as { password?: string };
    const lockPassword = process.env.VECTOR_LOCK_PASSWORD;

    if (!lockPassword) {
      res.status(500).json({ success: false, error: "Authentication not configured." });
      return;
    }

    if (!password || typeof password !== "string") {
      res.status(400).json({ success: false, error: "Authentication failed." });
      return;
    }

    // Constant-time comparison to prevent timing attacks (hash first so lengths match)
    const a = crypto.createHash("sha256").update(password).digest();
    const b = crypto.createHash("sha256").update(lockPassword).digest();

    if (crypto.timingSafeEqual(a, b)) {
      recordAuthSuccess();
      startSession(res);
      res.json({ success: true });
    } else {
      recordAuthFailure();
      res.json({ success: false, error: "Authentication failed." });
    }
  } catch {
    res.status(500).json({ success: false, error: "Authentication failed." });
  }
});

/** WebAuthn - Check if credentials are registered */
app.get("/api/auth/webauthn/status", (_req: express.Request, res: express.Response) => {
  res.json({ registered: listWebAuthnCredentials().length > 0 });
});

/** WebAuthn - Generate registration options (requires an unlocked session) */
app.post("/api/auth/webauthn/register/options", async (_req: express.Request, res: express.Response) => {
  try {
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: "vector-owner",
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      excludeCredentials: listWebAuthnCredentials().map((cred) => ({
        id: cred.credentialID,
        transports: cred.transports as AuthenticatorTransportFuture[] | undefined,
      })),
    });

    currentChallenge = options.challenge;
    res.json(options);
  } catch (err) {
    console.error("[VECTOR_CORE] WebAuthn registration options error:", (err as Error).message);
    res.status(500).json({ error: "Failed to generate registration options." });
  }
});

/** WebAuthn - Verify registration response (requires an unlocked session) */
app.post("/api/auth/webauthn/register/verify", async (req: express.Request, res: express.Response) => {
  try {
    if (!currentChallenge) {
      res.status(400).json({ success: false, error: "No challenge found. Request options first." });
      return;
    }

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: currentChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
    currentChallenge = undefined;

    if (verification.verified && verification.registrationInfo) {
      const { credential } = verification.registrationInfo;
      saveWebAuthnCredential({
        credentialID: credential.id,
        credentialPublicKey: credential.publicKey,
        counter: credential.counter,
        transports: req.body.response?.transports,
      });
      res.json({ success: true });
    } else {
      res.json({ success: false, error: "Registration verification failed." });
    }
  } catch (err) {
    console.error("[VECTOR_CORE] WebAuthn registration verify error:", (err as Error).message);
    res.status(500).json({ success: false, error: "Registration verification failed." });
  }
});

/** WebAuthn - Generate authentication options */
app.post("/api/auth/webauthn/authenticate/options", async (_req: express.Request, res: express.Response) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: listWebAuthnCredentials().map((cred) => ({
        id: cred.credentialID,
        transports: cred.transports as AuthenticatorTransportFuture[] | undefined,
      })),
      userVerification: "required",
    });

    currentChallenge = options.challenge;
    res.json(options);
  } catch (err) {
    console.error("[VECTOR_CORE] WebAuthn auth options error:", (err as Error).message);
    res.status(500).json({ error: "Failed to generate authentication options." });
  }
});

/** WebAuthn - Verify authentication response */
app.post("/api/auth/webauthn/authenticate/verify", async (req: express.Request, res: express.Response) => {
  try {
    if (lockedOut(res)) return;

    if (!currentChallenge) {
      res.status(400).json({ success: false, error: "No challenge found." });
      return;
    }

    const credential = listWebAuthnCredentials().find(
      (cred) => cred.credentialID === req.body.id
    );

    if (!credential) {
      recordAuthFailure();
      res.json({ success: false, error: "Authentication failed." });
      return;
    }

    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: currentChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credentialID,
        publicKey: credential.credentialPublicKey,
        counter: credential.counter,
        transports: credential.transports as AuthenticatorTransportFuture[] | undefined,
      },
    });
    currentChallenge = undefined;

    if (verification.verified) {
      updateWebAuthnCounter(credential.credentialID, verification.authenticationInfo.newCounter);
      recordAuthSuccess();
      startSession(res);
      res.json({ success: true });
    } else {
      recordAuthFailure();
      res.json({ success: false, error: "Authentication failed." });
    }
  } catch (err) {
    console.error("[VECTOR_CORE] WebAuthn auth verify error:", (err as Error).message);
    recordAuthFailure();
    res.status(500).json({ success: false, error: "Authentication failed." });
  }
});

// Bind to loopback only: VECTOR is never reachable from the network.
startScheduler();

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[VECTOR_CORE] Running on port ${PORT}`);
  console.log(`[VECTOR_CORE] Model: ${model}`);
  console.log(`[VECTOR_CORE] ElevenLabs TTS: ${elevenlabs ? "Enabled" : "Disabled"}`);
  console.log(`[VECTOR_CORE] Fish Audio TTS: ${fishAudioApiKey && fishAudioVoiceId ? "Enabled" : "Disabled"}`);
  const calStatus = getAuthStatus();
  console.log(`[VECTOR_CORE] Google Calendar: ${calStatus.connected ? "Connected" : "Not connected"}${!calStatus.credentialsFound ? " (credentials not found)" : ""}`);
  console.log(`[VECTOR_CORE] Gmail: ${calStatus.gmailGranted ? "Authorized" : "Not authorized (reconnect Google to grant)"}`);
  console.log(`[VECTOR_CORE] Web Search: ${searchProvider() ?? "Disabled (set TAVILY_API_KEY)"}`);
  console.log(`[VECTOR_CORE] Lock Screen: ${process.env.VECTOR_LOCK_PASSWORD ? "Enabled" : "Not configured"}`);
});
