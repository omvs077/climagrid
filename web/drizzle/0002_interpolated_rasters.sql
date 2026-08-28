-- Stores a smooth interpolated raster per layer per pipeline run, computed
-- via inverse-distance-weighting over spatial_grids cell centroids
-- (pipeline/interpolate.py). Flattened row-major double precision array;
-- rows/cols/bbox let the API reconstruct the 2D grid without ambiguity.
CREATE TABLE IF NOT EXISTS interpolated_rasters (
    raster_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city TEXT NOT NULL,
    layer_name TEXT NOT NULL,
    rows INTEGER NOT NULL,
    cols INTEGER NOT NULL,
    min_lon DOUBLE PRECISION NOT NULL,
    min_lat DOUBLE PRECISION NOT NULL,
    max_lon DOUBLE PRECISION NOT NULL,
    max_lat DOUBLE PRECISION NOT NULL,
    values DOUBLE PRECISION[] NOT NULL,
    pipeline_run_id UUID NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (city, layer_name)
);

CREATE INDEX IF NOT EXISTS idx_interpolated_rasters_city ON interpolated_rasters (city, layer_name);

GRANT SELECT ON interpolated_rasters TO web_readonly;