import type { ContextUsage } from "../types/vector";

interface ContextCardProps {
  data: ContextUsage;
}

const formatTokens = (value: number): string => {
  if (value >= 1000) {
    return (value / 1000).toFixed(0) + "K";
  }
  return value.toString();
};

const ContextCard = ({ data }: ContextCardProps) => {
  const percentage = Math.round((data.used / data.limit) * 100);
  const fillWidth = (data.used / data.limit) * 100;

  return (
    <div className="card">
      <div className="card__header">
        <span className="card__title">CONTEXT WINDOW</span>
        <span className="card__icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1" fill="none" />
            <line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
            <line x1="5" y1="7.5" x2="11" y2="7.5" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
            <line x1="5" y1="10" x2="9" y2="10" stroke="currentColor" strokeWidth="0.75" opacity="0.5" />
          </svg>
        </span>
      </div>
      <div className="card__body">
        <div className="context__main">
          <span className="context__percent">{percentage}%</span>
          <span className="context__detail">{formatTokens(data.used)} / {formatTokens(data.limit)} tokens</span>
        </div>
        <div className="usage__bar">
          <div className="usage__bar-fill" style={{ width: `${fillWidth}%` }} />
        </div>
      </div>
    </div>
  );
};

export default ContextCard;
