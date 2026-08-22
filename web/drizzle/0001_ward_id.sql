ALTER TABLE spatial_grids ADD COLUMN IF NOT EXISTS ward_id TEXT;
CREATE INDEX IF NOT EXISTS idx_spatial_grids_ward ON spatial_grids (ward_id, city);