export interface LocationContext {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  timezone: string;
  error: string | null;
}

export interface TimeContext {
  currentTime: string;
  currentDate: string;
  timezone: string;
  dayOfWeek: string;
}

export interface DailyForecast {
  date: string;
  dayOfWeek: string;
  weatherCode: number;
  condition: string;
  maxTemp: number;
  minTemp: number;
  precipitationProbability: number;
  precipitationSum: number;
}

export interface WeatherContext {
  temperature: number | null;
  condition: string | null;
  humidity: number | null;
  wind: number | null;
  high: number | null;
  low: number | null;
  precipitationProbability: number | null;
  weatherCode: number | null;
  forecast: DailyForecast[];
  isAvailable: boolean;
  error: string | null;
}

export interface SessionContext {
  voiceMode: boolean;
  conversationState: string;
  sessionActive: boolean;
  sessionActiveDuration: number; // in seconds
}

export interface CalendarContext {
  connected: boolean;
}

export interface SystemContext {
  availableDevices: string[];
  applicationState: string;
}

export interface VectorContextState {
  location: LocationContext;
  time: TimeContext;
  weather: WeatherContext;
  session: SessionContext;
  calendar: CalendarContext;
  system: SystemContext;
  updateTime?: (time: TimeContext) => void;
  updateSessionDuration?: (duration: number) => void;
}
