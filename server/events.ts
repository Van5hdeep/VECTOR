import type express from "express";

// ─── Live Event Stream ───────────────────────────────────────
// Server → UI push channel (reminders firing, etc.) over Server-Sent Events.

const clients = new Set<express.Response>();

export function handleEventStream(req: express.Request, res: express.Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
  clients.add(res);

  // Heartbeat as a real event: the client uses it to detect a dead (zombie) stream
  const heartbeat = setInterval(() => res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`), 20_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

export function broadcast(event: Record<string, unknown>): number {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(payload);
  return clients.size;
}
