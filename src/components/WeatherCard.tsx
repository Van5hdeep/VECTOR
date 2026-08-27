import type { WeatherData } from "../types/vector";

interface WeatherCardProps {
  data: WeatherData;
}

const WeatherIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Sun */}
    <circle cx="20" cy="18" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
    <line x1="20" y1="7" x2="20" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    <line x1="20" y1="27" x2="20" y2="29" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    <line x1="9" y1="18" x2="11" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    <line x1="29" y1="18" x2="31" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    {/* Cloud */}
    <path
      d="M16 32c-3.314 0-6-2.239-6-5s2.686-5 6-5c.353 0 .7.025 1.04.073C18.19 19.685 20.893 18 24 18c4.418 0 8 2.91 8 6.5 0 .169-.007.336-.02.5C34.236 25.483 36 27.09 36 29c0 2.21-2.239 4-5 4H16z"
      stroke="currentColor"
      strokeWidth="1.5"
      fill="none"
    />
  </svg>
);

const WeatherCard = ({ data }: WeatherCardProps) => {
  return (
    <div className="card">
      <div className="card__header">
        <span className="card__title">WEATHER</span>
        <span className="card__icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.4" />
            <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.3" />
          </svg>
        </span>
      </div>
      <div className="card__body">
        <div className="weather__main">
          <div className="weather__icon">
            <WeatherIcon />
          </div>
          <div className="weather__info">
            <div className="weather__location">{data.location}</div>
            <div className="weather__temp">{data.temperature}°C</div>
            <div className="weather__condition">{data.condition}</div>
          </div>
        </div>
        <div className="weather__details">
          <span className="weather__detail-item">{data.high}° / {data.low}°</span>
          <span className="weather__detail-separator">|</span>
          <span className="weather__detail-item">Humidity {data.humidity}%</span>
          <span className="weather__detail-separator">|</span>
          <span className="weather__detail-item">Wind {data.wind} km/h</span>
        </div>
      </div>
    </div>
  );
};

export default WeatherCard;
