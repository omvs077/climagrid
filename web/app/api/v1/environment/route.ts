import { citySchema, latLonSchema, errorResponse } from "@/lib/validation";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getEnvironmentSnapshot, CITY_ENVIRONMENT_CONFIG } from "@/lib/environment";

// GET /api/v1/environment?city=pune&lat=&lon=
// Read-only. Weather + air quality (WAQI, geo-based - reflects the given
// lat/lon, defaulting to the city's own coordinates if omitted) and any
// active IMD district weather warning (resolved from city, not lat/lon,
// since IMD warnings are issued per-district, not per-point).
export async function GET(request: Request) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return errorResponse("rate_limited", "Too many requests", 429);
  }

  const url = new URL(request.url);
  const cityResult = citySchema.safeParse(url.searchParams.get("city") ?? undefined);
  if (!cityResult.success) {
    return errorResponse("invalid_city", cityResult.error.issues[0]?.message ?? "invalid city", 400);
  }
  const city = cityResult.data;

  const latLonResult = latLonSchema.safeParse({
    lat: url.searchParams.get("lat") ?? undefined,
    lon: url.searchParams.get("lon") ?? undefined,
  });
  if (!latLonResult.success) {
    return errorResponse("invalid_location", latLonResult.error.issues[0]?.message ?? "invalid lat/lon", 400);
  }

  const config = CITY_ENVIRONMENT_CONFIG[city];
  if (!config && latLonResult.data.lat === undefined) {
    return errorResponse("not_found", `no environment config for city=${city}`, 404);
  }

  const lat = latLonResult.data.lat ?? config!.lat;
  const lon = latLonResult.data.lon ?? config!.lon;

  const snapshot = await getEnvironmentSnapshot(lat, lon, city);

  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
    },
  });
}