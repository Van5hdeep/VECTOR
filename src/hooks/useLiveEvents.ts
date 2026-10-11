import { useEffect, useRef, useState } from "react";

export type LiveEvent =
  | { type: "reminder"; id: number; conversationId: number | null; text: string }
  | { type: "briefing"; conversationId: number; text: string }
  | { type: "reminders_changed" }
  | { type: "conversation_titled"; id: number; title: string }
  /** Synthetic: the stream came back after a drop — refetch anything that may have changed */
  | { type: "reconnected" }
  /** Server heartbeats (handled here, not passed on) */
  | { type: "hello" }
  | { type: "ping" };

// The server pings every 20s; silence this long means the stream is dead even if the browser thinks it's open
const STALE_AFTER_MS = 45_000;
const PROBE_EVERY_MS = 8_000;
const PROBE_TIMEOUT_MS = 4_000;

/**
 * One EventSource for server pushes while VECTOR is unlocked.
 * Browsers stop retrying after an HTTP error, and a proxy can keep a dead
 * stream "open" after the server restarts, so reconnection is handled here.
 * Returns whether the server is responding (the stream itself can look healthy
 * behind a proxy while the server is gone, so a direct probe decides).
 */
export function useLiveEvents(enabled: boolean, onEvent: (event: LiveEvent) => void): boolean {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const [responding, setResponding] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let retryTimer = 0;
    let attempt = 0;
    let disposed = false;
    let lastSeen = Date.now();
    let everConnected = false;

    // Public endpoint: any answer below 500 means the server is up (a dead one gives a proxy 5xx or a network error)
    const probe = async () => {
      try {
        const res = await fetch("/api/auth/session", { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        if (!disposed) setResponding(res.status < 500);
      } catch {
        if (!disposed) setResponding(false);
      }
    };

    const connect = () => {
      source = new EventSource("/api/events");
      source.onopen = () => {
        lastSeen = Date.now();
        setResponding(true);
        if (everConnected) handlerRef.current({ type: "reconnected" });
        everConnected = true;
        attempt = 0;
      };
      source.onmessage = (e) => {
        lastSeen = Date.now();
        try {
          const event = JSON.parse(e.data) as LiveEvent;
          if (event.type !== "ping" && event.type !== "hello") handlerRef.current(event);
        } catch {
          // ignore malformed events
        }
      };
      source.onerror = () => {
        void probe();
        if (source?.readyState !== EventSource.CLOSED || disposed) return; // the browser is retrying itself
        source.close();
        attempt += 1;
        retryTimer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
      };
    };

    connect();

    // Watchdog for zombie streams
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastSeen < STALE_AFTER_MS) return;
      void probe();
      lastSeen = Date.now();
      window.clearTimeout(retryTimer);
      source?.close();
      connect();
    }, 10_000);
    const prober = window.setInterval(() => void probe(), PROBE_EVERY_MS);

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(watchdog);
      window.clearInterval(prober);
      source?.close();
    };
  }, [enabled]);

  return !enabled || responding;
}
