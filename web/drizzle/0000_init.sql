CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS spatial_grids (
  grid_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city            TEXT NOT NULL,
  geom            GEOMETRY(Geometry, 4326) NOT NULL,
  avg_lst_celsius NUMERIC,
  ndvi            NUMERIC,
  built_up_index  NUMERIC,
  traffic_density NUMERIC,
  pipeline_run_id UUID NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT geom_valid CHECK (ST_IsValid(geom))
);
CREATE INDEX IF NOT EXISTS idx_spatial_grids_geom ON spatial_grids USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_spatial_grids_city ON spatial_grids (city);

CREATE TABLE IF NOT EXISTS vulnerability_scores (
  ward_id         TEXT NOT NULL,
  city            TEXT NOT NULL,
  hvi_score       NUMERIC NOT NULL CHECK (hvi_score BETWEEN 0 AND 1),
  model_version   TEXT NOT NULL,
  pipeline_run_id UUID NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ward_id, city)
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city         TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  finished_at  TIMESTAMPTZ,
  status       TEXT NOT NULL,
  sources_used JSONB,
  notes        TEXT
);

-- Read-only role for /web — see README.md and SECURITY.md §4.
-- Safe to re-run: DO block skips creation if the role already exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'web_readonly') THEN
    CREATE ROLE web_readonly LOGIN PASSWORD 'changeme';
  END IF;
END
$$;
GRANT CONNECT ON DATABASE climagrid TO web_readonly;
GRANT USAGE ON SCHEMA public TO web_readonly;
GRANT SELECT ON spatial_grids, vulnerability_scores, pipeline_runs TO web_readonly;
