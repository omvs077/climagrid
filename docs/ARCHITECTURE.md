# ClimaGrid — Technical Architecture Document

## 1. Architecture Summary

Two components, cleanly separated by trust boundary:

1. **`/web`** — Next.js app. The *only* thing exposed to the public internet. Serves the UI and a small set of **read-only** API routes that query Postgres/PostGIS directly.
2. **`/pipeline`** — Python service. **Never exposed to the internet.** Runs on a schedule (cron), pulls satellite/OSM/weather data, fuses it, computes the HVI, and writes results into Postgres/PostGIS. It has no listening HTTP server at all — it's a batch job, not an API.

This split is the key security decision from the last review, restated for this simpler scope: **the only public attack surface is a stateless, read-only Next.js API.** There is nothing to authenticate, nothing to authorize, and nothing to inject into from the public side, because the public side never writes anything.

```
                    ┌─────────────────────────┐
   Satellite (GEE)  │                         │
   OSM Overpass     │   /pipeline (Python)    │      writes only
   Open-Meteo       │   scheduled job, cron   │ ───────────────┐
                     │   NOT internet-exposed  │                │
                     └─────────────────────────┘                ▼
                                                        ┌──────────────────┐
                                                        │ Postgres + PostGIS│
                                                        │  (Neon, managed)  │
                                                        └──────────────────┘
                                                                 ▲
                                                        read only│
                     ┌─────────────────────────┐                │
   Visitor's browser │   /web (Next.js)        │ ───────────────┘
   ───────────────►  │   API routes: GET only  │
                      │   MapLibre + mapcn UI   │
                      └─────────────────────────┘
```

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend framework | Next.js 15 (App Router) | React Server Components for the static/Learn pages, client components for the map |
| Map UI | `mapcn` (MapLibre GL + Tailwind + shadcn/ui) | Matches Next.js natively, no separate map-library integration work |
| Styling | Tailwind CSS + shadcn/ui | Comes bundled with mapcn's conventions |
| Public API | Next.js Route Handlers (`/app/api/.../route.ts`) | GET-only, thin query layer over PostGIS |
| Database | PostgreSQL + PostGIS extension | Hosted on Neon (free tier to start) |
| DB access (web) | `pg` or Drizzle ORM, parameterized queries only | No raw string-built SQL, ever (see SECURITY.md) |
| Data pipeline | Python 3.12, GeoPandas, Rasterio, `psycopg` | Runs as a scheduled job, not a server |
| Pipeline scheduling | GitHub Actions scheduled workflow, or a small cron on Railway/Fly.io | No inbound network access required at all |
| Caching | Next.js route-level caching / Vercel Edge caching on GET responses | Reduces DB load and blunts scrape/flood attempts even before rate-limiting kicks in |
| Rate limiting | Middleware-based IP rate limit (e.g. `@upstash/ratelimit` + Upstash Redis free tier, or Vercel's built-in) | Applied to all `/api/*` routes |
| Hosting | Vercel (web), Neon (DB), GitHub Actions or Fly.io (pipeline cron) | All free-tier viable for a demo-city launch |
| Error tracking | Sentry (free tier) | Both web and pipeline report here |
| Analytics | Plausible or Vercel Analytics (privacy-respecting, no cookies/PII) | Matches "no accounts, no PII" principle |

## 3. Data Model (PostGIS)

```sql
-- Written only by the pipeline. Read-only from /web.
CREATE TABLE spatial_grids (
  grid_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city            TEXT NOT NULL,              -- 'pune' for v1, kept generic for future
  geom            GEOMETRY(Polygon, 4326) NOT NULL,
  avg_lst_celsius NUMERIC,
  ndvi            NUMERIC,
  built_up_index  NUMERIC,
  traffic_density NUMERIC,
  pipeline_run_id UUID NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT geom_valid CHECK (ST_IsValid(geom))
);
CREATE INDEX idx_spatial_grids_geom ON spatial_grids USING GIST (geom);
CREATE INDEX idx_spatial_grids_city ON spatial_grids (city);

CREATE TABLE vulnerability_scores (
  ward_id         TEXT NOT NULL,
  city            TEXT NOT NULL,
  hvi_score       NUMERIC NOT NULL CHECK (hvi_score BETWEEN 0 AND 1),
  model_version   TEXT NOT NULL,
  pipeline_run_id UUID NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ward_id, city)
);

-- Audit trail for the pipeline itself (not user actions — there are none)
CREATE TABLE pipeline_runs (
  run_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city         TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL,   -- 'success' | 'failed' | 'partial'
  sources_used JSONB,           -- which APIs responded vs. fell back to cache
  notes        TEXT
);
```

No `users`, `devices`, `sensor_readings`, or `interventions` tables — they don't exist in this scope, which is the point.

## 4. Client-Side Mitigation Simulator (no backend involvement)

The simulator runs entirely against data already loaded into the browser for the visible map viewport:

1. User draws a polygon over one or more grid cells.
2. Client reads each covered cell's `ndvi`, `built_up_index`, `avg_lst_celsius` (already fetched for the visible viewport).
3. A documented, simplified formula (published on the Learn page, not hidden) estimates a plausible temperature delta from increasing NDVI in that area — e.g. a linear approximation calibrated from published urban-greening cooling studies, clearly labeled as an *illustrative estimate*, not a scientific prediction.
4. Result renders instantly, client-side. Nothing is persisted.

This intentionally avoids the old design's server-side "Predictive Impact Calculator" endpoint and the entire class of "client-trusted business logic" issues that came with it — there's no server computation to spoof because there's no server computation at all.

## 5. Data Pipeline Flow

1. Scheduled trigger (e.g. weekly) runs `/pipeline/run.py`.
2. Pulls Land Surface Temperature + NDVI from Google Earth Engine for the configured city bounding box.
3. Pulls road/building density from OSM Overpass API.
4. Pulls current/recent weather context from Open-Meteo.
5. Validates every external response before use (see `SECURITY.md §3`) — reject malformed geometry, out-of-range values, unexpectedly-sized payloads.
6. Fuses into the grid, computes HVI per ward.
7. Writes to Postgres inside a transaction, tagged with a new `pipeline_run_id`. Old data is only replaced after the new run fully succeeds (no partial-write windows visible to the public API).
8. Logs the run to `pipeline_runs`, reports failures to Sentry.

## 6. Why Not Django for the backend

You asked for Next.js frontend + Python backend for the heavy geo work. Given there's no public write API left, a full Django REST Framework server would be running 24/7 just to serve reads that Next.js can do directly against Postgres — that's an extra internet-facing service (extra attack surface, extra ops) for no benefit. Python is genuinely needed for GeoPandas/Rasterio-style raster processing, but that only needs to *run*, not *listen*. Keeping it as a scheduled job instead of a server is the single biggest simplification in this architecture, and it's free (GitHub Actions cron) instead of a paid always-on dyno.

If a future phase needs Python to serve something live (e.g. on-demand analysis a database view can't express), add a narrow internal-only service behind the Next.js layer at that point — don't pre-build it now.
