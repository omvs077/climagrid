"""
Database writes - the ONLY component with write access. All queries are
parameterized (see SECURITY.md), never string-built, even though this
component is "trusted" - defense in depth costs nothing here.
"""
from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg

logger = logging.getLogger(__name__)


@contextmanager
def get_connection(database_url: str):
    conn = psycopg.connect(database_url)
    try:
        yield conn
    finally:
        conn.close()


def start_pipeline_run(conn, city: str) -> str:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO pipeline_runs (city, started_at, status) VALUES (%s, %s, 'running') RETURNING run_id",
            (city, datetime.now(timezone.utc)),
        )
        run_id = cur.fetchone()[0]
    conn.commit()
    return str(run_id)


def finish_pipeline_run(conn, run_id: str, status: str, sources_used: dict, notes: str = "") -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE pipeline_runs SET finished_at=%s, status=%s, sources_used=%s, notes=%s WHERE run_id=%s",
            (datetime.now(timezone.utc), status, json.dumps(sources_used), notes, run_id),
        )
    conn.commit()


def write_grid_cells(conn, run_id: str, city: str, cells: list) -> int:
    """Writes this run's cells (including each cell's ward_id, so the API
    can later derive ward boundaries via ST_Union), then deletes the
    previous run's rows for this city - the public API never sees a
    half-written state."""
    written = 0
    with conn.cursor() as cur:
        for cell in cells:
            cur.execute(
                """
                INSERT INTO spatial_grids
                  (city, geom, avg_lst_celsius, ndvi, built_up_index, traffic_density, pipeline_run_id, ward_id)
                VALUES (%s, ST_GeomFromGeoJSON(%s), %s, %s, %s, %s, %s, %s)
                """,
                (city, json.dumps(cell.to_geojson()), cell.lst_celsius, cell.ndvi,
                 cell.built_up_index, cell.traffic_density, run_id, cell.ward_id),
            )
            written += 1
        cur.execute("DELETE FROM spatial_grids WHERE city=%s AND pipeline_run_id != %s", (city, run_id))
    conn.commit()
    return written


def write_interpolated_raster(conn, run_id: str, city: str, layer_name: str, raster: dict) -> None:
    min_lon, min_lat, max_lon, max_lat = raster["bbox"]
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO interpolated_rasters
              (city, layer_name, rows, cols, min_lon, min_lat, max_lon, max_lat, values, pipeline_run_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (city, layer_name) DO UPDATE
              SET rows=EXCLUDED.rows, cols=EXCLUDED.cols,
                  min_lon=EXCLUDED.min_lon, min_lat=EXCLUDED.min_lat,
                  max_lon=EXCLUDED.max_lon, max_lat=EXCLUDED.max_lat,
                  values=EXCLUDED.values, pipeline_run_id=EXCLUDED.pipeline_run_id,
                  computed_at=now()
            """,
            (city, layer_name, raster["rows"], raster["cols"],
             min_lon, min_lat, max_lon, max_lat, raster["values"], run_id),
        )
    conn.commit()


def write_vulnerability_scores(conn, run_id: str, city: str, model_version: str, scores: dict) -> int:
    written = 0
    with conn.cursor() as cur:
        for ward_id, hvi_score in scores.items():
            cur.execute(
                """
                INSERT INTO vulnerability_scores (ward_id, city, hvi_score, model_version, pipeline_run_id)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (ward_id, city) DO UPDATE
                  SET hvi_score=EXCLUDED.hvi_score, model_version=EXCLUDED.model_version,
                      pipeline_run_id=EXCLUDED.pipeline_run_id, computed_at=now()
                """,
                (ward_id, city, hvi_score, model_version, run_id),
            )
            written += 1
    conn.commit()
    return written