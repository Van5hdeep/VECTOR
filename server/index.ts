import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";
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

let sessionTokensUsed = 0;
// Default to 131,072 for gpt-oss-120b, fallback to 100,000 otherwise
const contextLimit = model === "openai/gpt-oss-120b" ? 131072 : 100000;

const app = express();
app.use(cors());
app.use(express.json());

interface ChatRequestBody {
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

app.post("/api/chat", async (req: express.Request, res: express.Response) => {
  try {
    const { message, history } = req.body as ChatRequestBody;

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

    // Append current user message
    messages.push({ role: "user", content: message.trim() });

    const stream = await groq.chat.completions.create({
      model: model,
      messages,
      temperature: 0.7,
      max_completion_tokens: 1024,
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
      
      // Extract usage from the final stream chunk
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const usage = (chunk as any).usage || (chunk as any).x_groq?.usage;
      if (usage) {
        sessionTokensUsed += usage.total_tokens || 0;
        contextTokensUsed = usage.prompt_tokens || 0;
      }
    }
    
    // Send telemetry to frontend before closing the stream
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

app.listen(PORT, () => {
  console.log(`[VECTOR_CORE] Running on port ${PORT}`);
  console.log(`[VECTOR_CORE] Model: ${model}`);
  const calStatus = getAuthStatus();
  console.log(`[VECTOR_CORE] Google Calendar: ${calStatus.connected ? "Connected" : "Not connected"}${!calStatus.credentialsFound ? " (credentials not found)" : ""}`);
});
