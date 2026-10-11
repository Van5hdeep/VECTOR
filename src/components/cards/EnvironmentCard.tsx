import { useEffect, useState } from "react";
import { useVectorContext } from "../../context/VectorContext";
import { formatAgo, formatClock, formatDayLong } from "../../lib/format";
import Icon, { WeatherGlyph } from "../ui/Icon";

/** Time + weather. Pure typography, no box: the clock is the card. */
export default function EnvironmentCard() {
  const { weather, location, weatherUpdatedAt, refreshWeather } = useVectorContext();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const clock = formatClock(now);
  const tz = new Intl.DateTimeFormat("en-IN", { timeZoneName: "short" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value;

  return (
    <section className="env" aria-label="Time and weather">
      <div className="env__clock num">
        <span className="env__hm">{clock.hm}</span>
        <span className="env__s">{clock.s}</span>
      </div>
      <div className="env__date">
        {formatDayLong(now)}
        <span className="env__tz">{tz}</span>
      </div>

      <div className="env__weather">
        {weather.isAvailable ? (
          <>
            <div className="env__now">
              <WeatherGlyph code={weather.weatherCode} size={44} />
              <div>
                <div className="env__temp num">{Math.round(weather.temperature ?? 0)}°</div>
                <div className="env__cond">{weather.condition}</div>
              </div>
              <div className="env__place">
                <Icon name="pin" size={13} /> {location.city ?? "Locating…"}
              </div>
            </div>

            <dl className="env__stats">
              <div><dt>High / low</dt><dd className="num">{Math.round(weather.high ?? 0)}° / {Math.round(weather.low ?? 0)}°</dd></div>
              <div><dt>Rain</dt><dd className="num">{weather.precipitationProbability ?? 0}%</dd></div>
              <div><dt>Humidity</dt><dd className="num">{weather.humidity ?? 0}%</dd></div>
              <div><dt>Wind</dt><dd className="num">{Math.round(weather.wind ?? 0)} km/h</dd></div>
            </dl>

            <ol className="env__forecast" aria-label="Next days">
              {weather.forecast.slice(1, 4).map((day) => (
                <li key={day.date}>
                  <span className="env__fday">{day.dayOfWeek.slice(0, 3)}</span>
                  <WeatherGlyph code={day.weatherCode} size={24} />
                  <span className="num">{Math.round(day.maxTemp)}°<span className="env__flow">{Math.round(day.minTemp)}°</span></span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="env__pending">
            {location.error ? "Allow location access to see local weather." : "Reading local conditions…"}
          </p>
        )}

        <div className="env__meta">
          <span>{weatherUpdatedAt ? `Updated ${formatAgo(weatherUpdatedAt, now.getTime())}` : "Waiting for location"}</span>
          <button className="icon-btn env__refresh" onClick={refreshWeather} aria-label="Refresh weather" title="Refresh weather">
            <Icon name="refresh" size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
