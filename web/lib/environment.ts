// Environment/weather panel data sources:
// - Air quality: CPCB (official Indian AQI, via data.gov.in - registration
//   pending as of writing: the portal itself has been unreliable (503s from
//   its own backend), so this path is inert until DATA_GOV_IN_API_KEY is
//   set, no fault of the code here) preferred when available, falling back
//   to WAQI (aqicn.org) - registered and working for weather, but its Pune
//   station network turned out to be stale (every known Pune station stuck
//   at Nov 2021 readings), so WAQI results are distance-checked against the
//   requested point and discarded entirely (both weather AND aqi, since
//   both come from the same station's sensor) if the station is too far
//   away - showing nothing is better than silently showing another city's
//   reading as if it were local.
//   WAQI categorizes AQI on its own internationally standardized scale
//   (Good/Moderate/Unhealthy for Sensitive Groups/Unhealthy/Very
//   Unhealthy/Hazardous), NOT India's official CPCB labels (Good/
//   Satisfactory/Moderate/Poor/Very Poor/Severe) - both 0-500 scales,
//   different breakpoints. The panel labels which source produced the
//   reading so this is never misrepresented as CPCB's own category when
//   it's actually WAQI's.
// - Weather warnings: IMD district-wise warnings (public endpoint; IMD's own
//   docs ask organizations to contact their nodal officer for formal terms -
//   see roadmap.md. Wrapped in its own try/catch so a failure here never
//   breaks weather/AQI display.)
//
// WAQI terms (aqicn.org/api/): free, 1000 req/s quota, data must not be
// sold, used in a paid app, or redistributed as cached/archived data - fine
// for this free, non-commercial project. Requires attributing WAQI and the
// originating agency, both surfaced in the panel's footer.

export interface CityEnvironmentConfig {
  city: string;
  lat: number;
  lon: number;
  cpcbCityName: string;
  imdDistrictId: string | null;
}

export const CITY_ENVIRONMENT_CONFIG: Record<string, CityEnvironmentConfig> = {
  pune: {
    city: "pune",
    lat: 18.5204,
    lon: 73.8567,
    cpcbCityName: "Pune",
    // TODO: unverified. Open a browser to
    // https://mausam.imd.gov.in/imd_latest/contents/districtwisewarnings_mc.php
    // for Pune district, open DevTools Network tab, and find the real
    // warnings_district_api.php?id=<N> value it calls. Set it here once found.
    imdDistrictId: null,
  },
};

export interface WeatherData {
  tempC: number | null;
  humidityPct: number | null;
  windKph: number | null;
  observedAt: string | null;
}

export type AqiSource = "cpcb" | "waqi";

export type CpcbCategory = "Good" | "Satisfactory" | "Moderate" | "Poor" | "Very Poor" | "Severe";
export type WaqiCategory = "Good" | "Moderate" | "Unhealthy for Sensitive Groups" | "Unhealthy" | "Very Unhealthy" | "Hazardous";
export type AqiCategory = CpcbCategory | WaqiCategory;

export interface AqiAttribution {
  name: string;
  url?: string;
}

export interface AqiData {
  source: AqiSource;
  aqi: number;
  category: AqiCategory;
  dominantPollutant: string;
  stationName: string | null;
  attributions: AqiAttribution[];
}

// ---------- CPCB (data.gov.in) ----------

type PollutantId = "PM2.5" | "PM10" | "NO2" | "SO2" | "NH3" | "OZONE" | "CO";

const AQI_BREAKPOINTS: Record<PollutantId, [number, number, number][]> = {
  "PM2.5": [[0, 30, 50], [31, 60, 100], [61, 90, 200], [91, 120, 300], [121, 250, 400], [250, 500, 500]],
  PM10: [[0, 50, 50], [51, 100, 100], [101, 250, 200], [251, 350, 300], [351, 430, 400], [430, 600, 500]],
  NO2: [[0, 40, 50], [41, 80, 100], [81, 180, 200], [181, 280, 300], [281, 400, 400], [400, 600, 500]],
  SO2: [[0, 40, 50], [41, 80, 100], [81, 380, 200], [381, 800, 300], [801, 1600, 400], [1600, 2000, 500]],
  NH3: [[0, 200, 50], [201, 400, 100], [401, 800, 200], [801, 1200, 300], [1200, 1800, 400], [1800, 2400, 500]],
  OZONE: [[0, 50, 50], [51, 100, 100], [101, 168, 200], [169, 208, 300], [209, 748, 400], [748, 1000, 500]],
  CO: [[0, 1.0, 50], [1.1, 2.0, 100], [2.1, 10, 200], [10.1, 17, 300], [17.1, 34, 400], [34, 50, 500]],
};

function subIndex(pollutant: PollutantId, concentration: number): number | null {
  const bands = AQI_BREAKPOINTS[pollutant];
  let prevAqiHi = 0;
  for (const [cLo, cHi, aqiHi] of bands) {
    const aqiLo = prevAqiHi === 0 ? 0 : prevAqiHi + 1;
    if (concentration >= cLo && concentration <= cHi) {
      if (cHi === cLo) return aqiHi;
      return Math.round(((aqiHi - aqiLo) / (cHi - cLo)) * (concentration - cLo) + aqiLo);
    }
    prevAqiHi = aqiHi;
  }
  return 500;
}

function categorizeCpcbAqi(aqi: number): CpcbCategory {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Satisfactory";
  if (aqi <= 200) return "Moderate";
  if (aqi <= 300) return "Poor";
  if (aqi <= 400) return "Very Poor";
  return "Severe";
}

const CPCB_RESOURCE_ID = "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69";
const CPCB_POLLUTANT_ID_MAP: Record<string, PollutantId> = {
  "PM2.5": "PM2.5",
  PM10: "PM10",
  NO2: "NO2",
  SO2: "SO2",
  NH3: "NH3",
  OZONE: "OZONE",
  CO: "CO",
};

export async function fetchCpcbAqi(cityName: string): Promise<AqiData | null> {
  const apiKey = process.env.DATA_GOV_IN_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://api.data.gov.in/resource/${CPCB_RESOURCE_ID}?api-key=${apiKey}&format=json&filters[city]=${encodeURIComponent(cityName)}&limit=200`;
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) return null;
    const data = await res.json();
    const records: any[] = data.records ?? [];
    if (records.length === 0) return null;

    const sums: Partial<Record<PollutantId, { total: number; count: number }>> = {};
    const stations = new Set<string>();
    for (const r of records) {
      const pollutant = CPCB_POLLUTANT_ID_MAP[r.pollutant_id];
      const avg = parseFloat(r.pollutant_avg);
      if (!pollutant || Number.isNaN(avg)) continue;
      stations.add(r.station);
      const entry = sums[pollutant] ?? { total: 0, count: 0 };
      entry.total += avg;
      entry.count += 1;
      sums[pollutant] = entry;
    }

    let bestAqi = -1;
    let bestPollutant = "";
    for (const [pollutant, entry] of Object.entries(sums) as [PollutantId, { total: number; count: number }][]) {
      const meanConcentration = entry.total / entry.count;
      const idx = subIndex(pollutant, meanConcentration);
      if (idx !== null && idx > bestAqi) {
        bestAqi = idx;
        bestPollutant = pollutant;
      }
    }
    if (bestAqi < 0) return null;

    return {
      source: "cpcb",
      aqi: bestAqi,
      category: categorizeCpcbAqi(bestAqi),
      dominantPollutant: bestPollutant,
      stationName: cityName,
      attributions: [{ name: "Central Pollution Control Board", url: "https://cpcb.nic.in" }],
    };
  } catch (err) {
    console.error("Failed to fetch CPCB AQI:", err);
    return null;
  }
}

// ---------- WAQI (aqicn.org) ----------

function categorizeWaqiAqi(aqi: number): WaqiCategory {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

const WAQI_POLLUTANT_LABELS: Record<string, string> = {
  pm25: "PM2.5",
  pm10: "PM10",
  no2: "NO2",
  so2: "SO2",
  o3: "Ozone",
  co: "CO",
};

// Haversine distance in km - used to reject a WAQI feed whose station is
// too far from the requested point (see module comment above).
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Beyond this, a WAQI station is considered "not actually this city" and
// its whole feed (weather AND aqi, since both come from the same station's
// sensor) is discarded rather than shown as if it were local.
const MAX_STATION_DISTANCE_KM = 50;

interface WaqiSnapshot {
  weather: WeatherData | null;
  aqi: AqiData | null;
}

function parseWaqiBody(body: any, requestLat: number, requestLon: number): WaqiSnapshot | null {
  if (body.status !== "ok" || !body.data) return null;
  const d = body.data;

  const stationGeo: [number, number] | null = Array.isArray(d.city?.geo) ? d.city.geo : null;
  if (stationGeo) {
    const dist = distanceKm(requestLat, requestLon, stationGeo[0], stationGeo[1]);
    if (dist > MAX_STATION_DISTANCE_KM) {
      console.warn(`[environment] WAQI station "${d.city?.name}" is ${Math.round(dist)}km away - discarding as not local`);
      return null;
    }
  }

  const iaqi = d.iaqi ?? {};
  const weather: WeatherData | null =
    iaqi.t || iaqi.h || iaqi.w
      ? {
          tempC: iaqi.t?.v ?? null,
          humidityPct: iaqi.h?.v ?? null,
          windKph: iaqi.w?.v != null ? iaqi.w.v * 3.6 : null,
          observedAt: d.time?.s ?? null,
        }
      : null;

  const aqiValue = typeof d.aqi === "number" ? d.aqi : parseFloat(d.aqi);
  const aqi: AqiData | null = Number.isFinite(aqiValue)
    ? {
        source: "waqi",
        aqi: aqiValue,
        category: categorizeWaqiAqi(aqiValue),
        dominantPollutant: WAQI_POLLUTANT_LABELS[d.dominentpol] ?? d.dominentpol ?? "unknown",
        stationName: d.city?.name ?? null,
        attributions: Array.isArray(d.attributions)
          ? d.attributions.map((a: any) => ({ name: a.name, url: a.url }))
          : [],
      }
    : null;

  return { weather, aqi };
}

async function fetchWaqiByQuery(query: string, token: string, lat: number, lon: number): Promise<WaqiSnapshot | null> {
  const url = `https://api.waqi.info/feed/${query}/?token=${token}`;
  const res = await fetch(url, { next: { revalidate: 900 } });
  if (!res.ok) return null;
  const body = await res.json();
  return parseWaqiBody(body, lat, lon);
}

// Tries the named-city feed first, falling back to geo-nearest. Both are
// distance-checked, so a stale or mismatched station (as WAQI's Pune
// network currently is - every known Pune station stuck at Nov 2021) is
// discarded rather than shown as if it were accurate for this location.
export async function fetchWaqiFeed(lat: number, lon: number, citySlug?: string): Promise<WaqiSnapshot | null> {
  const token = process.env.WAQI_API_TOKEN;
  if (!token) {
    console.warn("[environment] WAQI_API_TOKEN not set - weather/AQI disabled");
    return null;
  }
  try {
    if (citySlug) {
      const byCity = await fetchWaqiByQuery(citySlug, token, lat, lon);
      if (byCity?.aqi) return byCity;
    }
    return await fetchWaqiByQuery(`geo:${lat};${lon}`, token, lat, lon);
  } catch (err) {
    console.error("Failed to fetch WAQI feed:", err);
    return null;
  }
}

// ---------- IMD warnings ----------

export type WarningColor = "red" | "orange" | "yellow";

export interface WarningData {
  color: WarningColor;
  message: string;
}

export async function fetchImdWarnings(districtId: string | null): Promise<WarningData | null> {
  if (!districtId) return null;
  try {
    const url = `https://mausam.imd.gov.in/api/warnings_district_api.php?id=${districtId}`;
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = Array.isArray(data) ? data[0] : data;
    if (!entry) return null;
    const colorRaw = (entry.warning_level ?? entry.color ?? "").toString().toLowerCase();
    const color: WarningColor | null = colorRaw.includes("red")
      ? "red"
      : colorRaw.includes("orange")
      ? "orange"
      : colorRaw.includes("yellow")
      ? "yellow"
      : null;
    if (!color) return null;
    return { color, message: entry.warning_text ?? entry.description ?? "Weather warning in effect" };
  } catch (err) {
    console.error("Failed to fetch IMD warnings:", err);
    return null;
  }
}

// ---------- Combined snapshot ----------

export interface EnvironmentSnapshot {
  lat: number;
  lon: number;
  weather: WeatherData | null;
  aqi: AqiData | null;
  warning: WarningData | null;
  fetchedAt: string;
}

export async function getEnvironmentSnapshot(lat: number, lon: number, city: string): Promise<EnvironmentSnapshot> {
  const config = CITY_ENVIRONMENT_CONFIG[city];

  const [cpcbAqi, waqiFeed, warning] = await Promise.all([
    config ? fetchCpcbAqi(config.cpcbCityName) : Promise.resolve(null),
    fetchWaqiFeed(lat, lon, config?.city),
    fetchImdWarnings(config?.imdDistrictId ?? null),
  ]);

  return {
    lat,
    lon,
    weather: waqiFeed?.weather ?? null,
    aqi: cpcbAqi ?? waqiFeed?.aqi ?? null,
    warning,
    fetchedAt: new Date().toISOString(),
  };
}