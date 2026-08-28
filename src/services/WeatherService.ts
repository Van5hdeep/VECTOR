import type { WeatherContext, DailyForecast } from "../types/context";

// Caching mechanisms
let cachedLocationName: string | null = null;
let lastWeatherFetch: number = 0;
let cachedWeather: WeatherContext | null = null;
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export function getWMOWeatherCondition(code: number): string {
  if (code === 0) return "Clear Sky";
  if (code === 1) return "Mainly Clear";
  if (code === 2) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 85 && code <= 86) return "Snow Showers";
  if (code >= 95 && code <= 99) return "Thunderstorm";
  return "Unknown";
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  if (cachedLocationName) return cachedLocationName;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
      headers: {
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    if (!res.ok) throw new Error("Failed to reverse geocode");
    const data = await res.json();
    const city = data.address.city || data.address.town || data.address.village || data.address.county || "Unknown Location";
    cachedLocationName = city;
    return city;
  } catch (err) {
    console.error("[WeatherService] Reverse geocode error:", err);
    return "Local Area";
  }
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherContext> {
  const now = Date.now();
  if (cachedWeather && (now - lastWeatherFetch < CACHE_DURATION_MS)) {
    return cachedWeather;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch weather from Open-Meteo");
    
    const data = await res.json();
    const current = data.current;
    const daily = data.daily;

    const forecast: DailyForecast[] = [];
    if (daily && daily.time) {
      for (let i = 0; i < Math.min(daily.time.length, 7); i++) {
        const dateObj = new Date(daily.time[i]);
        const dayOfWeek = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
        
        forecast.push({
          date: daily.time[i],
          dayOfWeek,
          weatherCode: daily.weather_code[i],
          condition: getWMOWeatherCondition(daily.weather_code[i]),
          maxTemp: Math.round(daily.temperature_2m_max[i]),
          minTemp: Math.round(daily.temperature_2m_min[i]),
          precipitationProbability: daily.precipitation_probability_max[i] || 0,
          precipitationSum: daily.precipitation_sum[i] || 0,
        });
      }
    }

    const weatherCtx: WeatherContext = {
      temperature: Math.round(current.temperature_2m),
      condition: getWMOWeatherCondition(current.weather_code),
      humidity: Math.round(current.relative_humidity_2m),
      wind: Math.round(current.wind_speed_10m),
      high: Math.round(daily.temperature_2m_max[0]),
      low: Math.round(daily.temperature_2m_min[0]),
      precipitationProbability: daily.precipitation_probability_max[0] || 0,
      weatherCode: current.weather_code,
      forecast,
      isAvailable: true,
      error: null
    };

    cachedWeather = weatherCtx;
    lastWeatherFetch = now;
    return weatherCtx;
  } catch (err) {
    console.error("[WeatherService] Open-Meteo error:", err);
    return {
      temperature: null, condition: null, humidity: null, wind: null,
      high: null, low: null, precipitationProbability: null, weatherCode: null,
      forecast: [], isAvailable: false, error: (err as Error).message
    };
  }
}
