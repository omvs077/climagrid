import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/validation";

// GET /api/v1/meta
// Available cities, layer definitions, last pipeline run status.
// Powers the UI's legend and (future) city selector. See API_CONTRACT.md.
export async function GET(request: Request) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return errorResponse("rate_limited", "Too many requests", 429);
  }

  const runs = await db.execute(sql`
    SELECT DISTINCT ON (city) city, run_id, status, finished_at, sources_used
    FROM pipeline_runs
    ORDER BY city, started_at DESC
  `);

  const cities = runs.rows.map((row: any) => ({
    city: row.city,
    last_run_id: row.run_id,
    last_run_status: row.status,
    last_updated_at: row.finished_at,
    sources_used: row.sources_used,
  }));

  return Response.json(
    {
      cities,
      layers: [
        { id: "lst", label: "Land Surface Temperature", unit: "celsius" },
        { id: "ndvi", label: "Vegetation Index (NDVI)", unit: "index -1 to 1" },
        { id: "built_up", label: "Built-up Density", unit: "index 0 to 1" },
        { id: "traffic", label: "Traffic/Road Density", unit: "index 0 to 1" },
      ],
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    }
  );
}