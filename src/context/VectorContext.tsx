import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import type { 
  VectorContextState, 
  LocationContext, 
  TimeContext, 
  WeatherContext,
  SessionContext,
  CalendarContext,
  SystemContext
} from "../types/context";
import { fetchWeather, reverseGeocode } from "../services/WeatherService";

const defaultVectorContext: VectorContextState = {
  location: { latitude: null, longitude: null, city: null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, error: null },
  time: { currentTime: "", currentDate: "", timezone: "", dayOfWeek: "" },
  weather: { temperature: null, condition: null, humidity: null, wind: null, high: null, low: null, precipitationProbability: null, weatherCode: null, forecast: [], isAvailable: false, error: null },
  session: { voiceMode: false, conversationState: "standby", sessionActive: false, sessionActiveDuration: 0 },
  calendar: { connected: false },
  system: { availableDevices: [], applicationState: "running" }
};

const VectorContext = createContext<VectorContextState>(defaultVectorContext);

export const useVectorContext = () => useContext(VectorContext);

export const VectorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [location, setLocation] = useState<LocationContext>(defaultVectorContext.location);
  const [time, setTime] = useState<TimeContext>(defaultVectorContext.time);
  const [weather, setWeather] = useState<WeatherContext>(defaultVectorContext.weather);
  const [session, setSession] = useState<SessionContext>(defaultVectorContext.session);
  const [calendar, setCalendar] = useState<CalendarContext>(defaultVectorContext.calendar);
  const [system, setSystem] = useState<SystemContext>(defaultVectorContext.system);

  // Time and Session updates are provided by existing TimeCard and SessionCard components
  const updateTime = React.useCallback((newTime: TimeContext) => {
    setTime(newTime);
  }, []);

  const updateSessionDuration = React.useCallback((duration: number) => {
    setSession(prev => ({ ...prev, sessionActiveDuration: duration }));
  }, []);

  // 2. Geolocation & Weather
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocation(prev => ({ ...prev, error: "Geolocation is not supported by your browser" }));
      return;
    }

    const handleSuccess = async (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      
      setLocation(prev => ({ ...prev, latitude: lat, longitude: lon, error: null }));
      
      const city = await reverseGeocode(lat, lon);
      setLocation(prev => ({ ...prev, city }));

      const weatherData = await fetchWeather(lat, lon);
      setWeather(weatherData);
    };

    const handleError = (err: GeolocationPositionError) => {
      setLocation(prev => ({ ...prev, error: err.message }));
    };

    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 600000 // 10 minutes cache
    });
  }, []);

  // 3. Calendar Status Check
  useEffect(() => {
    const checkCalendar = async () => {
      try {
        const res = await fetch("/api/calendar/status");
        if (res.ok) {
          const data = await res.json();
          setCalendar({ connected: data.connected });
        }
      } catch (err) {
        console.error("[VectorContext] Calendar status check failed", err);
      }
    };
    checkCalendar();
  }, []);

  // 4. System (Media Devices)
  useEffect(() => {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const available = devices.map(d => d.kind).filter((value, index, self) => self.indexOf(value) === index);
        setSystem(prev => ({ ...prev, availableDevices: available }));
      }).catch(() => {});
    }
  }, []);

  const value = useMemo(() => ({
    location,
    time,
    weather,
    session,
    calendar,
    system,
    updateTime,
    updateSessionDuration
  }), [location, time, weather, session, calendar, system, updateTime, updateSessionDuration]);

  return (
    <VectorContext.Provider value={value}>
      {children}
    </VectorContext.Provider>
  );
};
