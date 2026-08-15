import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { bboxSchema, citySchema, errorResponse } from "@/lib/validation";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

// GET /api/v1/grid?bbox=minLon,minLat,maxLon,maxLat&city=pune&layers=lst,ndvi
// Read-only. See API_CONTRACT.md.
export async function GET(request: Request) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return errorResponse("rate_limited", "Too many requests", 429);
  }

  const url = new URL(request.url);
  const bboxParam = url.searchParams.get("bbox");
  if (!bboxParam) {
    return errorResponse("missing_bbox", "bbox query param is required", 400);
  }

  const bboxResult = bboxSchema.safeParse(bboxParam);
  if (!bboxResult.success) {
    return errorResponse("invalid_bbox", bboxResult.error.issues[0]?.message ?? "invalid bbox", 400);
  }
  const { minLon, minLat, maxLon, maxLat } = bboxResult.data;

  const cityResult = citySchema.safeParse(url.searchParams.get("city") ?? undefined);
  if (!cityResult.success) {
    return errorResponse("invalid_city", "invalid city identifier", 400);
  }
  const city = cityResult.data;

  const rows = await db.execute(sql`
    SELECT
      grid_id,
      ST_AsGeoJSON(geom) AS geometry,
      avg_lst_celsius,
      ndvi,
      built_up_index,
      traffic_density,
      pipeline_run_id,
      computed_at
    FROM spatial_grids
    WHERE city = ${city}
      AND ST_Intersects(geom, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))
    LIMIT 2000
  `);

  const cells = rows.rows.map((row: any) => ({
    grid_id: row.grid_id,
    geometry: JSON.parse(row.geometry),
    lst_celsius: row.avg_lst_celsius !== null ? Number(row.avg_lst_celsius) : null,
    ndvi: row.ndvi !== null ? Number(row.ndvi) : null,
    built_up_index: row.built_up_index !== null ? Number(row.built_up_index) : null,
    traffic_density: row.traffic_density !== null ? Number(row.traffic_density) : null,
  }));

  return Response.json(
    {
      city,
      pipeline_run_id: cells[0]?.pipeline_run_id ?? null,
      cells,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    }
  );
}