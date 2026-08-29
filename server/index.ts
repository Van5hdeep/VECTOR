import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import Groq, { toFile } from "groq-sdk";
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

dotenv.config();

const PORT = 3001;

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

let sessionTokensUsed = 0;
// Default to 131,072 for gpt-oss-120b, fallback to 100,000 otherwise
const contextLimit = model === "openai/gpt-oss-120b" ? 131072 : 100000;

const app = express();
app.use(cors());
app.use(express.json());

interface ChatRequestBody {
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
  isVoice?: boolean;
  clientContext?: any;
}

// Intent Recognition for Context Injection
function getRequiredContext(message: string, clientContext: any): string[] {
  if (!clientContext) return [];
  const reqLower = message.toLowerCase();
  const injectedContexts: string[] = [];

  if (reqLower.includes("time") || reqLower.includes("date") || reqLower.includes("day") || reqLower.includes("timezone")) {
    injectedContexts.push(`[SYSTEM CONTEXT: TIME]
Current Time: ${clientContext.time?.currentTime}
Current Date: ${clientContext.time?.currentDate}
Day of Week: ${clientContext.time?.dayOfWeek}
Timezone: ${clientContext.time?.timezone}`);
  }

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

  if (reqLower.includes("calendar") || reqLower.includes("event") || reqLower.includes("schedule") || reqLower.includes("meeting")) {
    injectedContexts.push(`[SYSTEM CONTEXT: CALENDAR]
Calendar Connected: ${clientContext.calendar?.connected ? "Yes" : "No"}
(Note: If connected, upcoming events are available in the calendar system)`);
  }
  
  return injectedContexts;
}

app.post("/api/chat", async (req: express.Request, res: express.Response) => {
  try {
    const { message, history, isVoice, clientContext } = req.body as ChatRequestBody;

    // Validate message
    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    // Build conversation messages
    const messages: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: VECTOR_SYSTEM_PROMPT },
    ];

    // Append conversation history if provided
    if (Array.isArray(history)) {
      for (const msg of history) {
        if (msg.role && msg.content) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
    }

    if (isVoice) {
      messages.push({
        role: "system",
        content: "The following input was spoken by the user via voice. Respond naturally as a voice assistant. Do not use text-based phrasing like 'I can see your message'. Use conversational spoken language."
      });
    }

    // Context Injection
    const requiredContexts = getRequiredContext(message, clientContext);
    
    // For Calendar, if it's requested and connected, fetch the events
    if (requiredContexts.some(c => c.includes("SYSTEM CONTEXT: CALENDAR") && c.includes("Yes"))) {
      try {
        const events = await listEvents();
        requiredContexts.push(`[SYSTEM CONTEXT: CALENDAR EVENTS]
${JSON.stringify(events, null, 2)}`);
      } catch (e) {
        requiredContexts.push(`[SYSTEM CONTEXT: CALENDAR EVENTS] Error fetching events.`);
      }
    }

    if (requiredContexts.length > 0) {
      messages.push({
        role: "system",
        content: `LIVE APPLICATION CONTEXT:\n${requiredContexts.join("\n\n")}\n\nUse this actual runtime data to answer the user's request. Do not say you don't have access to this information.`
      });
    }

    // Append current user message
    messages.push({ role: "user", content: message.trim() });

    const stream = await groq.chat.completions.create({
      model: model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      stream: true,
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    let contextTokensUsed = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
      }
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const usage = (chunk as any).usage || (chunk as any).x_groq?.usage;
      if (usage) {
        sessionTokensUsed += usage.total_tokens || 0;
        contextTokensUsed = usage.prompt_tokens || 0;
      }
    }

    if (contextTokensUsed > 0) {
      res.write(`data: ${JSON.stringify({ telemetry: { sessionTokensUsed, contextTokensUsed, contextLimit } })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err: unknown) {
    if (!res.headersSent) {
      // Handle Groq rate limit
      if (err instanceof Groq.APIError && err.status === 429) {
        res.status(429).json({
          error: "I'm receiving too many requests right now. Please try again in a moment.",
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
//  ElevenLabs TTS Route
// ═══════════════════════════════════════════════════════════

interface TTSRequestBody {
  text: string;
}

app.post("/api/tts", async (req: express.Request, res: express.Response) => {
  try {
    const { text } = req.body as TTSRequestBody;

    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "Text is required for speech synthesis." });
      return;
    }
    console.log("[VECTOR_TTS] TTS request started, text length:", text.length);

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

    // Safely iterate the Web ReadableStream
    const reader = audioStream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err: any) {
    // Log the full diagnostic error from the SDK (e.g., authentication_error details)
    console.error("[VECTOR_CORE] ElevenLabs TTS error:", JSON.stringify(err?.body || err?.message || err, null, 2));

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

/** Generate Google OAuth authorization URL */
app.get("/api/calendar/auth", (_req: express.Request, res: express.Response) => {
  try {
    const authUrl = getAuthUrl();
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
    if (!code) {
      res.status(400).send("Authorization code missing.");
      return;
    }

    await handleOAuthCallback(code);

    // Redirect back to the frontend with a success indicator
    const frontendUrl = req.headers.referer
      ? new URL(req.headers.referer).origin
      : "http://localhost:5173";
    res.redirect(`${frontendUrl}?calendar_connected=true`);
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
const origin = "http://localhost:5173";

// In-memory WebAuthn credential store (sufficient for dev; replace with DB later)
interface StoredCredential {
  credentialID: string;
  credentialPublicKey: Uint8Array;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
}
const webauthnCredentials: StoredCredential[] = [];
let currentChallenge: string | undefined;

/** Password authentication */
app.post("/api/auth/password", (req: express.Request, res: express.Response) => {
  try {
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

    // Constant-time comparison to prevent timing attacks
    const a = Buffer.from(password);
    const b = Buffer.from(lockPassword);

    let match = false;
    if (a.length === b.length) {
      match = crypto.timingSafeEqual(a, b);
    }

    if (match) {
      res.json({ success: true });
    } else {
      res.json({ success: false, error: "Authentication failed." });
    }
  } catch {
    res.status(500).json({ success: false, error: "Authentication failed." });
  }
});

/** WebAuthn - Check if credentials are registered */
app.get("/api/auth/webauthn/status", (_req: express.Request, res: express.Response) => {
  res.json({ registered: webauthnCredentials.length > 0 });
});

/** WebAuthn - Generate registration options */
app.post("/api/auth/webauthn/register/options", async (_req: express.Request, res: express.Response) => {
  try {
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: "vector-user",
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      excludeCredentials: webauthnCredentials.map((cred) => ({
        id: cred.credentialID,
        type: "public-key" as const,
        transports: cred.transports,
      })),
    });

    currentChallenge = options.challenge;
    res.json(options);
  } catch (err) {
    console.error("[VECTOR_CORE] WebAuthn registration options error:", (err as Error).message);
    res.status(500).json({ error: "Failed to generate registration options." });
  }
});

/** WebAuthn - Verify registration response */
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

    if (verification.verified && verification.registrationInfo) {
      const { credential } = verification.registrationInfo;
      webauthnCredentials.push({
        credentialID: credential.id,
        credentialPublicKey: credential.publicKey,
        counter: credential.counter,
        transports: req.body.response?.transports,
      });
      currentChallenge = undefined;
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
      allowCredentials: webauthnCredentials.map((cred) => ({
        id: cred.credentialID,
        type: "public-key" as const,
        transports: cred.transports,
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
    if (!currentChallenge) {
      res.status(400).json({ success: false, error: "No challenge found." });
      return;
    }

    const credential = webauthnCredentials.find(
      (cred) => cred.credentialID === req.body.id
    );

    if (!credential) {
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
        transports: credential.transports,
      },
    });

    if (verification.verified) {
      credential.counter = verification.authenticationInfo.newCounter;
      currentChallenge = undefined;
      res.json({ success: true });
    } else {
      res.json({ success: false, error: "Authentication failed." });
    }
  } catch (err) {
    console.error("[VECTOR_CORE] WebAuthn auth verify error:", (err as Error).message);
    res.status(500).json({ success: false, error: "Authentication failed." });
  }
});

app.listen(PORT, () => {
  console.log(`[VECTOR_CORE] Running on port ${PORT}`);
  console.log(`[VECTOR_CORE] Model: ${model}`);
  console.log(`[VECTOR_CORE] ElevenLabs TTS: ${elevenlabs ? "Enabled" : "Disabled"}`);
  const calStatus = getAuthStatus();
  console.log(`[VECTOR_CORE] Google Calendar: ${calStatus.connected ? "Connected" : "Not connected"}${!calStatus.credentialsFound ? " (credentials not found)" : ""}`);
  console.log(`[VECTOR_CORE] Lock Screen: ${process.env.VECTOR_LOCK_PASSWORD ? "Enabled" : "Not configured"}`);
});
