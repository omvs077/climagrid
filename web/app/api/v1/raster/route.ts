import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { citySchema, rasterLayerSchema, errorResponse } from "@/lib/validation";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// GET /api/v1/raster?city=pune&layer=lst_celsius
// Read-only. Returns a smooth interpolated (IDW) raster surface for one
// data layer, computed by the pipeline (pipeline/interpolate.py). Powers
// the frontend's "Smooth view" toggle - the discrete grid endpoint
// (/api/v1/grid) remains the source of truth for exact per-cell values.
export async function GET(request: Request) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return errorResponse("rate_limited", "Too many requests", 429);
  }

  const url = new URL(request.url);

  const cityResult = citySchema.safeParse(url.searchParams.get("city") ?? undefined);
  if (!cityResult.success) {
    return errorResponse("invalid_city", "invalid city identifier", 400);
  }
  const city = cityResult.data;

  const layerResult = rasterLayerSchema.safeParse(url.searchParams.get("layer"));
  if (!layerResult.success) {
    return errorResponse("invalid_layer", layerResult.error.issues[0]?.message ?? "invalid layer", 400);
  }
  const layer = layerResult.data;

  const rows = await db.execute(sql`
    SELECT rows, cols, min_lon, min_lat, max_lon, max_lat, values, pipeline_run_id, computed_at
    FROM interpolated_rasters
    WHERE city = ${city} AND layer_name = ${layer}
    LIMIT 1
  `);

  const row = rows.rows[0] as
    | {
        rows: number;
        cols: number;
        min_lon: number;
        min_lat: number;
        max_lon: number;
        max_lat: number;
        values: number[];
        pipeline_run_id: string;
        computed_at: string;
      }
    | undefined;

  if (!row) {
    return errorResponse("not_found", `no raster found for city=${city} layer=${layer}`, 404);
  }

  return Response.json(
    {
      city,
      layer,
      rows: row.rows,
      cols: row.cols,
      bbox: [row.min_lon, row.min_lat, row.max_lon, row.max_lat],
      values: row.values,
      pipeline_run_id: row.pipeline_run_id,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    }
  );
}