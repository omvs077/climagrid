"use client";

import { useEffect, useRef, useState } from "react";
import { fetchEnvironment, type EnvironmentResponse } from "@/lib/api";
import { Spinner } from "@/components/spinner";

const REFRESH_MS = 15 * 60 * 1000;
const PAN_DEBOUNCE_MS = 2000;

const AQI_COLORS: Record<string, string> = {
  Good: "#4C9A4A",
  Moderate: "#F2C94C",
  "Unhealthy for Sensitive Groups": "#F2994A",
  Unhealthy: "#EB5757",
  "Very Unhealthy": "#9B51E0",
  Hazardous: "#7C1D1D",
};

const WARNING_COLORS: Record<string, string> = {
  red: "#D93025",
  orange: "#F2994A",
  yellow: "#F2C94C",
};

export function EnvironmentPanel({ city, lat, lon }: { city: string; lat?: number; lon?: number }) {
  const [data, setData] = useState<EnvironmentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    function load() {
      if (!hasLoadedRef.current) setLoading(true);
      fetchEnvironment(city, lat, lon)
        .then((res) => {
          setData(res);
          setError(false);
          hasLoadedRef.current = true;
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, PAN_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, lat, lon]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchEnvironment(city, lat, lon)
        .then((res) => {
          setData(res);
          setError(false);
          hasLoadedRef.current = true;
        })
        .catch(() => setError(true));
    }, REFRESH_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error && !data) return null;

  if (loading && !data) {
    return (
      <div className="flex w-56 max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
        <Spinner className="h-3.5 w-3.5" />
        Loading environment data&hellip;
      </div>
    );
  }

  if (!data) return null;
  if (!data.weather && !data.aqi && !data.warning) return null;

  return (
    <div className="w-56 max-w-[calc(100vw-2rem)] rounded-lg border bg-background/90 p-3 shadow-sm backdrop-blur">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="block text-xs font-medium text-muted-foreground">
          Environment - {city[0].toUpperCase() + city.slice(1)}
        </span>
        {loading && <Spinner className="h-3 w-3 text-muted-foreground" />}
      </div>

      {data.warning && (
        <div
          className="mb-2 rounded px-2 py-1 text-[11px] font-medium text-white"
          style={{ backgroundColor: WARNING_COLORS[data.warning.color] }}
        >
          IMD {data.warning.color.toUpperCase()} alert: {data.warning.message}
        </div>
      )}

      {data.weather && (
        <div className="mb-2 text-xs text-foreground">
          <span className="font-medium">
            {data.weather.tempC !== null ? Math.round(data.weather.tempC) + "\u00b0C" : "-"}
          </span>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {data.weather.humidityPct !== null && `Humidity ${Math.round(data.weather.humidityPct)}%`}
            {data.weather.windKph !== null && ` - Wind ${Math.round(data.weather.windKph)} km/h`}
          </div>
        </div>
      )}

      {data.aqi && (
        <div className="flex items-center gap-2 text-xs">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
            style={{ backgroundColor: AQI_COLORS[data.aqi.category] ?? "#888" }}
          >
            AQI {Math.round(data.aqi.aqi)}
          </span>
          <span className="text-muted-foreground">
            {data.aqi.category} - {data.aqi.dominantPollutant}
          </span>
        </div>
      )}

      <div className="mt-2 text-[9px] text-muted-foreground">
        {data.aqi && data.aqi.attributions.length > 0
          ? "Source: " + data.aqi.attributions.map((a) => a.name).join(", ")
          : "Source: World Air Quality Index Project"}
        {data.warning && " - Warnings: IMD"}
      </div>
    </div>
  );
}
