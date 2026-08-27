import type { TokenUsage } from "../types/vector";

interface TokenUsageCardProps {
  data: TokenUsage;
}

const formatTokens = (value: number): string => {
  if (value >= 1000) {
    return (value / 1000).toFixed(1) + "K";
  }
  return value.toString();
};

const TokenUsageCard = ({ data }: TokenUsageCardProps) => {
  const percentage = ((data.used / data.limit) * 100).toFixed(1);
  const fillWidth = (data.used / data.limit) * 100;

  return (
    <div className="card">
      <div className="card__header">
        <span className="card__title">{data.label}</span>
        <span className="card__icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="10" width="2.5" height="4" rx="0.5" fill="currentColor" opacity="0.4" />
            <rect x="5.5" y="7" width="2.5" height="7" rx="0.5" fill="currentColor" opacity="0.5" />
            <rect x="9" y="4" width="2.5" height="10" rx="0.5" fill="currentColor" opacity="0.6" />
            <rect x="12.5" y="2" width="2.5" height="12" rx="0.5" fill="currentColor" opacity="0.7" />
          </svg>
        </span>
      </div>
      <div className="card__body">
        <div className="usage__value-row">
          <span className="usage__value">{formatTokens(data.used)}</span>
          <span className="usage__limit">/ {formatTokens(data.limit)}</span>
        </div>
        <div className="usage__bar">
          <div className="usage__bar-fill" style={{ width: `${fillWidth}%` }} />
        </div>
        <div className="usage__percentage">{percentage}%</div>
      </div>
    </div>
  );
};

export default TokenUsageCard;
