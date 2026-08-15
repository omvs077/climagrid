import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  jsonb,
  customType,
} from "drizzle-orm/pg-core";

/**
 * PostGIS geometry column. Drizzle has no native PostGIS type, so this is a
 * thin custom type — the DB handles GeoJSON <-> geometry conversion via
 * ST_AsGeoJSON / ST_GeomFromGeoJSON, keeping raw geometry bytes out of app code.
 */
const geometry = customType<{ data: string }>({
  dataType() {
    return "geometry(Geometry, 4326)";
  },
});

/**
 * Written ONLY by /pipeline. Read-only from /web.
 * See ARCHITECTURE.md §3 and SECURITY.md §3.
 */
export const spatialGrids = pgTable("spatial_grids", {
  gridId: uuid("grid_id").primaryKey().defaultRandom(),
  city: text("city").notNull(),
  geom: geometry("geom").notNull(),
  avgLstCelsius: numeric("avg_lst_celsius"),
  ndvi: numeric("ndvi"),
  builtUpIndex: numeric("built_up_index"),
  trafficDensity: numeric("traffic_density"),
  pipelineRunId: uuid("pipeline_run_id").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const vulnerabilityScores = pgTable("vulnerability_scores", {
  wardId: text("ward_id").notNull(),
  city: text("city").notNull(),
  hviScore: numeric("hvi_score").notNull(),
  modelVersion: text("model_version").notNull(),
  pipelineRunId: uuid("pipeline_run_id").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // composite PK (ward_id, city) added via raw SQL migration — see drizzle/0000_init.sql
});

/** Audit trail for pipeline runs — not user actions, there are none. */
export const pipelineRuns = pgTable("pipeline_runs", {
  runId: uuid("run_id").primaryKey().defaultRandom(),
  city: text("city").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(), // 'success' | 'failed' | 'partial'
  sourcesUsed: jsonb("sources_used"),
  notes: text("notes"),
});
