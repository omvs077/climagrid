"""
Grid generation and data fusion for the ClimaGrid pipeline.
Builds a regular grid over a city bbox, attaches layer values from each
source, and computes a simplified heat-vulnerability index (HVI).
"""
from __future__ import annotations
import config

import math
from dataclasses import dataclass

from shapely.geometry import Polygon, mapping


@dataclass
class GridCell:
    minx: float
    miny: float
    maxx: float
    maxy: float
    row: int
    col: int
    lst_celsius: float | None = None
    ndvi: float | None = None
    built_up_index: float | None = None
    traffic_density: float | None = None

    @property
    def polygon(self) -> Polygon:
        return Polygon([
            (self.minx, self.miny), (self.maxx, self.miny),
            (self.maxx, self.maxy), (self.minx, self.maxy),
            (self.minx, self.miny),
        ])

    @property
    def ward_id(self) -> str:
        return f"W-{self.row // config.WARD_BLOCK_SIZE}-{self.col // config.WARD_BLOCK_SIZE}"

    def to_geojson(self) -> dict:
        return mapping(self.polygon)


def build_grid(bbox: tuple[float, float, float, float], cell_size: float) -> list[GridCell]:
    min_lon, min_lat, max_lon, max_lat = bbox
    if min_lon >= max_lon or min_lat >= max_lat:
        raise ValueError(f"Invalid bbox: {bbox}")

    cols = max(1, math.ceil((max_lon - min_lon) / cell_size - 1e-9))
    rows = max(1, math.ceil((max_lat - min_lat) / cell_size - 1e-9))

    cells: list[GridCell] = []
    for row in range(rows):
        for col in range(cols):
            minx = min_lon + col * cell_size
            miny = min_lat + row * cell_size
            maxx = min(minx + cell_size, max_lon)
            maxy = min(miny + cell_size, max_lat)
            cells.append(GridCell(minx, miny, maxx, maxy, row=row, col=col))
    return cells


def attach_layer_values(cells, lst_ndvi_by_cell, built_up_by_cell, traffic_by_cell) -> None:
    for cell in cells:
        key = (cell.row, cell.col)
        lst_ndvi = lst_ndvi_by_cell.get(key, {})
        cell.lst_celsius = lst_ndvi.get("lst_celsius")
        cell.ndvi = lst_ndvi.get("ndvi")
        cell.built_up_index = built_up_by_cell.get(key)
        cell.traffic_density = traffic_by_cell.get(key)


def validate_cell(cell: GridCell) -> list[str]:
    """Defense-in-depth (see SECURITY.md, data pipeline section) - the DB
    also enforces these constraints, but we reject bad data before it's
    sent, so a bad run fails loudly instead of silently."""
    errors = []
    if not cell.polygon.is_valid:
        errors.append("invalid geometry")
    if cell.lst_celsius is not None and not (-30 <= cell.lst_celsius <= 65):
        errors.append(f"lst_celsius out of range: {cell.lst_celsius}")
    if cell.ndvi is not None and not (-1 <= cell.ndvi <= 1):
        errors.append(f"ndvi out of range: {cell.ndvi}")
    if cell.built_up_index is not None and not (0 <= cell.built_up_index <= 1):
        errors.append(f"built_up_index out of range: {cell.built_up_index}")
    if cell.traffic_density is not None and not (0 <= cell.traffic_density <= 1):
        errors.append(f"traffic_density out of range: {cell.traffic_density}")
    return errors


def compute_hvi(cells: list[GridCell]) -> dict[str, float]:
    """Weighted blend of high LST, low NDVI, high built-up, high traffic,
    normalized 0-1. Documented on the Learn page, not a hidden black box."""
    by_ward: dict[str, list[GridCell]] = {}
    for cell in cells:
        by_ward.setdefault(cell.ward_id, []).append(cell)

    scores: dict[str, float] = {}
    for ward_id, ward_cells in by_ward.items():
        valid = [c for c in ward_cells if c.lst_celsius is not None and c.ndvi is not None]
        if not valid:
            continue

        lsts = [c.lst_celsius for c in valid]
        lst_min, lst_max = min(lsts), max(lsts)

        def norm_lst(v: float) -> float:
            return 0.5 if lst_max == lst_min else (v - lst_min) / (lst_max - lst_min)

        raw_scores = []
        for c in valid:
            heat = norm_lst(c.lst_celsius)
            green_deficit = 1 - max(0.0, min(1.0, (c.ndvi + 1) / 2))
            built = c.built_up_index or 0.0
            traffic = c.traffic_density or 0.0
            raw_scores.append(0.4 * heat + 0.25 * green_deficit + 0.2 * built + 0.15 * traffic)

        scores[ward_id] = round(sum(raw_scores) / len(raw_scores), 4)

    return scores