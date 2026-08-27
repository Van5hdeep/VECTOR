import { useState, useEffect } from "react";

const TimeCard = () => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: undefined,
      hour12: true,
    });
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  return (
    <div className="card">
      <div className="card__header">
        <span className="card__title">TIME</span>
        <span className="card__icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1" fill="none" />
            <line x1="8" y1="4" x2="8" y2="8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <line x1="8" y1="8" x2="11" y2="10" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </span>
      </div>
      <div className="card__body">
        <div className="time__value">{formatTime(now)}</div>
        <div className="time__date">{formatDate(now)}</div>
      </div>
    </div>
  );
};

export default TimeCard;
