"""
OSM Overpass API: road/building density per grid cell. Real HTTP calls -
free, no API key. Every response is validated before use (see SECURITY.md,
data pipeline section).

Pune's full bbox is too large for Overpass to process in a single query
(returns 504 Gateway Timeout even with lightweight "skel center" output).
Fix: split the bbox into a grid of smaller tiles, query each separately,
and merge results. This is standard practice for Overpass at city scale.
"""
from __future__ import annotations

import logging
import time
import requests

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]
HEADERS = {"User-Agent": "ClimaGrid/0.1 (educational urban-heat project)"}
CONNECT_TIMEOUT_SECONDS = 10
READ_TIMEOUT_SECONDS = 60
MAX_RESPONSE_BYTES = 25 * 1024 * 1024

# Number of tiles per side - 3x3 = 9 smaller queries instead of 1 huge one.
TILE_GRID_SIZE = 3
# Overpass's usage policy asks for reasonable spacing between requests.
DELAY_BETWEEN_REQUESTS_SECONDS = 1.5

logger = logging.getLogger(__name__)


def _split_bbox(bbox, grid_size: int) -> list[tuple[float, float, float, float]]:
    min_lon, min_lat, max_lon, max_lat = bbox
    lon_step = (max_lon - min_lon) / grid_size
    lat_step = (max_lat - min_lat) / grid_size

    tiles = []
    for i in range(grid_size):
        for j in range(grid_size):
            tiles.append((
                min_lon + i * lon_step,
                min_lat + j * lat_step,
                min_lon + (i + 1) * lon_step,
                min_lat + (j + 1) * lat_step,
            ))
    return tiles


def _build_query(bbox) -> str:
    min_lon, min_lat, max_lon, max_lat = bbox
    bbox_str = f"{min_lat},{min_lon},{max_lat},{max_lon}"
    return f"""
    [out:json][timeout:{READ_TIMEOUT_SECONDS}];
    (
      way["highway"]({bbox_str});
      way["building"]({bbox_str});
    );
    out skel center;
    """


def _fetch_tile(tile_bbox) -> list[dict]:
    query = _build_query(tile_bbox)

    for url in OVERPASS_URLS:
        try:
            response = requests.post(
                url,
                data={"data": query},
                headers=HEADERS,
                timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            logger.warning("Overpass tile request to %s failed: %s", url, exc)
            continue

        if len(response.content) > MAX_RESPONSE_BYTES:
            logger.warning("Overpass tile response from %s exceeded size cap, discarding", url)
            continue

        try:
            payload = response.json()
        except ValueError:
            logger.warning("Overpass tile response from %s was non-JSON, discarding", url)
            continue

        elements = payload.get("elements", [])
        if not isinstance(elements, list):
            continue

        return elements

    return []


def fetch_osm_features(bbox) -> list[dict]:
    tiles = _split_bbox(bbox, TILE_GRID_SIZE)
    all_elements: list[dict] = []

    for idx, tile_bbox in enumerate(tiles):
        elements = _fetch_tile(tile_bbox)
        all_elements.extend(elements)
        logger.info("Overpass tile %d/%d: %d elements", idx + 1, len(tiles), len(elements))
        if idx < len(tiles) - 1:
            time.sleep(DELAY_BETWEEN_REQUESTS_SECONDS)

    logger.info("Overpass: %d total elements across %d tiles", len(all_elements), len(tiles))
    return all_elements


def compute_density_by_cell(elements, rows: int, cols: int, bbox) -> dict[tuple[int, int], float]:
    min_lon, min_lat, max_lon, max_lat = bbox
    cell_w = (max_lon - min_lon) / cols
    cell_h = (max_lat - min_lat) / rows

    counts: dict[tuple[int, int], int] = {}
    for el in elements:
        center = el.get("center")
        if not center or "lon" not in center or "lat" not in center:
            continue
        lon, lat = center["lon"], center["lat"]
        col = min(max(int((lon - min_lon) / cell_w) if cell_w else 0, 0), cols - 1)
        row = min(max(int((lat - min_lat) / cell_h) if cell_h else 0, 0), rows - 1)
        counts[(row, col)] = counts.get((row, col), 0) + 1

    if not counts:
        return {(r, c): 0.0 for r in range(rows) for c in range(cols)}
    max_count = max(counts.values())
    return {
        (r, c): round(counts.get((r, c), 0) / max_count, 3)
        for r in range(rows)
        for c in range(cols)
    }