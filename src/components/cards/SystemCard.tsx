import { useEffect, useState } from "react";
import { getSystemStatus, type ConnectionState, type SystemStatus } from "../../api/status";
import type { TelemetryData } from "../../types/vector";
import { formatDuration, formatTokens } from "../../lib/format";

interface SystemCardProps {
  telemetry: TelemetryData | null;
  onlineSince: number;
  /** Bumped when something changes connections (e.g. Google reconnect) */
  version: number;
}

const STATE_INFO: Record<ConnectionState, { dot: string; text: string }> = {
  connected: { dot: "dot--ok", text: "Connected" },
  expired: { dot: "dot--warn", text: "Login expired — reconnect from the Calendar card" },
  disconnected: { dot: "dot--off", text: "Not connected — connect from the Calendar card" },
  not_granted: { dot: "dot--warn", text: "Needs permission — reconnect Google and allow Gmail" },
  disabled: { dot: "dot--off", text: "Add TAVILY_API_KEY to .env to enable" },
};

export default function SystemCard({ telemetry, onlineSince, version }: SystemCardProps) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const load = () => getSystemStatus().then(setStatus).catch(() => {});
    void load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
  }, [version]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const tokens = telemetry?.sessionTokensUsed ?? status?.sessionTokensUsed ?? 0;
  const ctxUsed = telemetry?.contextTokensUsed ?? 0;
  const ctxLimit = telemetry?.contextLimit ?? status?.contextLimit ?? 131072;
  const ctxPct = Math.min(100, (ctxUsed / ctxLimit) * 100);

  const rows: { name: string; state: ConnectionState }[] = status
    ? [
        { name: "Calendar", state: status.calendar },
        { name: "Gmail", state: status.gmail },
        { name: "Web search", state: status.webSearch === "disabled" ? "disabled" : "connected" },
        { name: "Voice", state: "connected" }, // the local voice is always available
      ]
    : [];

  return (
    <section className="system" aria-label="System">
      <header className="rail-block__head">
        <h2 className="label">System</h2>
        <span className="system__uptime">Online {formatDuration(Math.floor((now - onlineSince) / 1000))}</span>
      </header>

      <div className="system__gauges">
        <div className="gauge">
          <span className="gauge__label">Tokens this session</span>
          <span className="gauge__value num">{formatTokens(tokens)}</span>
        </div>
        <div className="gauge">
          <span className="gauge__label">Context</span>
          <span className="gauge__value num">{formatTokens(ctxUsed)}<small> / {formatTokens(ctxLimit)}</small></span>
          <span className="gauge__bar"><span style={{ width: `${Math.max(ctxPct, 1)}%` }} /></span>
        </div>
      </div>

      <ul className="system__links">
        {rows.map((row) => {
          const info = STATE_INFO[row.state];
          return (
            <li key={row.name} title={info.text}>
              <span className={`dot ${info.dot}`} />
              <span>{row.name}</span>
              {row.state !== "connected" && <span className="system__hint">{info.text}</span>}
            </li>
          );
        })}
      </ul>
      {status && <p className="system__model">Model {status.model}</p>}
    </section>
  );
}
