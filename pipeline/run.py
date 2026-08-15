"""
ClimaGrid pipeline entry point. Scheduled job (GitHub Actions cron) — never
internet-facing, only initiates outbound calls. See ARCHITECTURE.md §5.

Usage:
    python run.py --city pune
    python run.py --city pune --mock   # force mock GEE data
"""
from __future__ import annotations

import argparse
import logging
import sys

import config
import fusion
from db import finish_pipeline_run, get_connection, start_pipeline_run, write_grid_cells, write_vulnerability_scores
from sources import gee, openmeteo, overpass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("climagrid.pipeline")


def run(city: str, force_mock: bool) -> None:
    bbox = config.get_bbox(city)
    use_mock_gee = force_mock or not config.GEE_SERVICE_ACCOUNT_JSON
    if use_mock_gee:
        logger.info("No GEE credentials configured — using mock LST/NDVI data")

    cells = fusion.build_grid(bbox, config.GRID_CELL_SIZE_DEG)
    rows = max(c.row for c in cells) + 1
    cols = max(c.col for c in cells) + 1
    logger.info("Built grid: %d cells (%d rows x %d cols)", len(cells), rows, cols)

    sources_used = {}

    lst_ndvi = gee.fetch_lst_ndvi(bbox, rows, cols, use_mock=use_mock_gee)
    sources_used["gee"] = "mock" if use_mock_gee else "live"

    osm_elements = overpass.fetch_osm_features(bbox)
    built_up_by_cell = overpass.compute_density_by_cell(osm_elements, rows, cols, bbox)
    sources_used["overpass"] = "live" if osm_elements else "unavailable"

    traffic_by_cell = built_up_by_cell  # simple proxy for v1, documented in ARCHITECTURE.md

    center_lon, center_lat = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    weather = openmeteo.fetch_current_weather(center_lat, center_lon)
    sources_used["open_meteo"] = "live" if weather else "unavailable"
    if weather:
        logger.info("Current weather context: %s", weather)

    fusion.attach_layer_values(cells, lst_ndvi, built_up_by_cell, traffic_by_cell)

    valid_cells, rejected = [], 0
    for cell in cells:
        errors = fusion.validate_cell(cell)
        if errors:
            rejected += 1
            logger.warning("Rejecting cell (%d,%d): %s", cell.row, cell.col, errors)
        else:
            valid_cells.append(cell)

    if rejected:
        logger.warning("%d/%d cells rejected by validation", rejected, len(cells))
    if not valid_cells:
        raise RuntimeError("All grid cells failed validation — aborting write")

    hvi_scores = fusion.compute_hvi(valid_cells)
    logger.info("Computed HVI for %d wards", len(hvi_scores))

    with get_connection(config.DATABASE_URL) as conn:
        run_id = start_pipeline_run(conn, city)
        try:
            n_cells = write_grid_cells(conn, run_id, city, valid_cells)
            n_scores = write_vulnerability_scores(conn, run_id, city, config.MODEL_VERSION, hvi_scores)
            status = "partial" if rejected else "success"
            finish_pipeline_run(conn, run_id, status, sources_used,
                                 notes=f"wrote {n_cells} cells, {n_scores} ward scores, {rejected} rejected")
            logger.info("Pipeline run %s finished: %s", run_id, status)
        except Exception as exc:
            finish_pipeline_run(conn, run_id, "failed", sources_used, notes=str(exc))
            logger.exception("Pipeline run %s failed", run_id)
            raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the ClimaGrid data pipeline")
    parser.add_argument("--city", default=config.DEMO_CITY)
    parser.add_argument("--mock", action="store_true")
    args = parser.parse_args()
    try:
        run(args.city, args.mock)
    except Exception:
        logger.exception("Pipeline run failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
