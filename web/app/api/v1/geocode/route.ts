import { NextRequest, NextResponse } from "next/server";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
// Nominatim viewbox format: left,top,right,bottom = minLon,maxLat,maxLon,minLat
const PUNE_VIEWBOX = "73.74,18.62,73.95,18.43";
const USER_AGENT =
  "ClimaGrid/1.0 (https://github.com/omvs077/climagrid; public urban heat island viewer)";

// Naive in-memory cache + throttle. Resets on server restart or per
// serverless instance - acceptable for MVP traffic; revisit if this becomes
// a bottleneck (see roadmap Phase 4 scaling notes).
const cache = new Map<string, { data: GeocodeResult[]; expires: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let lastUpstreamCallAt = 0;
const MIN_INTERVAL_MS = 1100; // Nominatim usage policy: max 1 req/sec

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 3) {
    return NextResponse.json({ results: [] });
  }

  const cacheKey = q.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json({ results: cached.data });
  }

  const waitMs = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastUpstreamCallAt));
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastUpstreamCallAt = Date.now();

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("viewbox", PUNE_VIEWBOX);
  url.searchParams.set("bounded", "1");

  let upstream: NominatimResult[];
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      return NextResponse.json(
        { results: [], error: "Geocoding service unavailable" },
        { status: 502 },
      );
    }
    upstream = await res.json();
  } catch {
    return NextResponse.json(
      { results: [], error: "Geocoding service unavailable" },
      { status: 502 },
    );
  }

  const results: GeocodeResult[] = upstream.map((r) => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
  }));

  cache.set(cacheKey, { data: results, expires: Date.now() + CACHE_TTL_MS });

  return NextResponse.json({ results });
}