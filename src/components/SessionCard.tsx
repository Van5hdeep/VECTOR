import { useState, useEffect, useRef } from "react";

const SessionCard = () => {
  const sessionStart = useRef(new Date());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStart.current.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatElapsed = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { hours, minutes, seconds };
  };

  const formatStartTime = (date: Date): string => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const { hours, minutes, seconds } = formatElapsed(elapsed);

  return (
    <div className="card">
      <div className="card__header">
        <span className="card__title">SESSION ACTIVE TIME</span>
        <span className="card__icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <polyline points="1,12 4,6 7,9 10,3 13,8 15,5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      <div className="card__body">
        <div className="session__value">
          {String(hours).padStart(2, "0")}
          <span>h </span>
          {String(minutes).padStart(2, "0")}
          <span>m </span>
          {String(seconds).padStart(2, "0")}
          <span>s</span>
        </div>
        <div className="session__since">
          Active since {formatStartTime(sessionStart.current)}
        </div>
      </div>
    </div>
  );
};

export default SessionCard;
