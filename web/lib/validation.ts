import { z } from "zod";

// bbox: minLon,minLat,maxLon,maxLat
// Capped server-side so one request cannot pull excessive data at once
// (see SECURITY.md, public read API section).
export const MAX_BBOX_AREA_DEG2 = 0.1;

export const bboxSchema = z
  .string()
  .transform((val, ctx) => {
    const parts = val.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
      ctx.addIssue({ code: "custom", message: "bbox must be minLon,minLat,maxLon,maxLat" });
      return z.NEVER;
    }
    const [minLon, minLat, maxLon, maxLat] = parts;
    if (minLon >= maxLon || minLat >= maxLat) {
      ctx.addIssue({ code: "custom", message: "bbox min must be less than max" });
      return z.NEVER;
    }
    const area = (maxLon - minLon) * (maxLat - minLat);
    if (area > MAX_BBOX_AREA_DEG2) {
      ctx.addIssue({ code: "custom", message: `bbox exceeds maximum area of ${MAX_BBOX_AREA_DEG2} deg^2` });
      return z.NEVER;
    }
    return { minLon, minLat, maxLon, maxLat };
  });

export const citySchema = z
  .string()
  .regex(/^[a-z0-9_-]{1,50}$/, "invalid city identifier")
  .default("pune");

export const layersSchema = z
  .string()
  .optional()
  .transform((val) =>
    val ? val.split(",").filter((l) => ["lst", "ndvi", "built_up", "traffic"].includes(l)) : ["lst", "ndvi", "built_up", "traffic"]
  );

export const rasterLayerSchema = z.enum(["lst_celsius", "ndvi", "built_up_index", "traffic_density"], {
  message: "layer must be one of lst_celsius, ndvi, built_up_index, traffic_density",
});

export function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}