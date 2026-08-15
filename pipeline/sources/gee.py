"""
Google Earth Engine data source: LST + NDVI.
Behind a clean interface — the rest of the pipeline never touches the GEE
SDK directly. Falls back to a deterministic mock generator when no service
account is configured, so the pipeline runs end-to-end before GEE signup.
"""
from __future__ import annotations

import hashlib
import math
import os


def _mock_value_for_cell(row: int, col: int, seed: str) -> float:
    h = hashlib.sha256(f"{seed}-{row}-{col}".encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def fetch_lst_ndvi_mock(rows: int, cols: int) -> dict[tuple[int, int], dict]:
    """Simulates a hotter, less-green core and cooler, greener outskirts —
    enough structure to sanity-check fusion/HVI logic without real satellite data."""
    center_row, center_col = rows / 2, cols / 2
    max_dist = math.hypot(center_row, center_col) or 1

    result = {}
    for row in range(rows):
        for col in range(cols):
            dist = math.hypot(row - center_row, col - center_col) / max_dist
            noise = _mock_value_for_cell(row, col, "lst") * 4 - 2
            lst = 42 - dist * 10 + noise
            ndvi_noise = _mock_value_for_cell(row, col, "ndvi") * 0.2 - 0.1
            ndvi = min(0.9, max(-0.1, dist * 0.7 + ndvi_noise))
            result[(row, col)] = {"lst_celsius": round(lst, 2), "ndvi": round(ndvi, 3)}
    return result


def fetch_lst_ndvi_real(bbox, rows: int, cols: int) -> dict[tuple[int, int], dict]:
    """Real implementation — requires GEE_SERVICE_ACCOUNT_JSON and earthengine-api.
    Left as a documented stub with the intended shape; fill in once GEE access exists."""
    import ee

    service_account_path = os.environ["GEE_SERVICE_ACCOUNT_JSON"]
    credentials = ee.ServiceAccountCredentials(None, service_account_path)
    ee.Initialize(credentials)

    # TODO: query MODIS LST + Sentinel-2 NDVI ImageCollections, reduce over
    # each grid cell, reshape into {(row, col): {"lst_celsius":.., "ndvi":..}}
    raise NotImplementedError(
        "Real GEE integration not yet implemented — set GEE_MOCK=true to "
        "use mock data while you set up Earth Engine access."
    )


def fetch_lst_ndvi(bbox, rows: int, cols: int, use_mock: bool) -> dict[tuple[int, int], dict]:
    if use_mock:
        return fetch_lst_ndvi_mock(rows, cols)
    return fetch_lst_ndvi_real(bbox, rows, cols)
