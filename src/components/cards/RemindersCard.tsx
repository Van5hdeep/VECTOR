import { useCallback, useEffect, useState } from "react";
import { getReminders, cancelReminder, type Reminder } from "../../api/status";
import { formatDue } from "../../lib/format";
import Icon from "../ui/Icon";

interface RemindersCardProps {
  /** Bumped by live events when reminders change */
  version: number;
}

export default function RemindersCard({ version }: RemindersCardProps) {
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setReminders(await getReminders());
    } catch {
      setReminders((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  // Keep "in 4 min" labels honest, and re-sync as a backstop to live events
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
      void load();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const cancel = async (id: number) => {
    setReminders((prev) => prev?.filter((r) => r.id !== id) ?? null);
    await cancelReminder(id);
  };

  return (
    <section className="rail-block" aria-label="Reminders">
      <header className="rail-block__head">
        <h2 className="label">Reminders</h2>
        {reminders && reminders.length > 0 && <span className="rail-block__count num">{reminders.length}</span>}
      </header>

      {reminders === null ? null : reminders.length === 0 ? (
        <p className="rail-block__empty">Nothing scheduled. Say "remind me in 20 minutes to…"</p>
      ) : (
        <ul className="reminders">
          {reminders.slice(0, 6).map((r) => (
            <li key={r.id} className="reminders__item">
              <Icon name={r.repeat === "none" ? "bell" : "repeat"} size={15} className="reminders__icon" />
              <div className="reminders__text">
                <span className="reminders__msg">{r.message}</span>
                <span className="reminders__due num">
                  {formatDue(r.dueAt, now)}
                  {r.repeat !== "none" && ` · ${r.repeat}`}
                </span>
              </div>
              <button className="icon-btn reminders__cancel" onClick={() => cancel(r.id)} aria-label={`Cancel reminder: ${r.message}`}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
