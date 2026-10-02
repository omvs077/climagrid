"""
Google Earth Engine data source: LST + NDVI.
Behind a clean interface - the rest of the pipeline never touches the GEE
SDK directly. Falls back to a deterministic mock generator when no service
account is configured, so the pipeline runs end-to-end before GEE signup.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from datetime import datetime, timezone


def _mock_value_for_cell(row: int, col: int, seed: str) -> float:
    h = hashlib.sha256(f"{seed}-{row}-{col}".encode()).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def fetch_lst_ndvi_mock(rows: int, cols: int) -> dict[tuple[int, int], dict]:
    """Simulates a hotter, less-green core and cooler, greener outskirts -
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


def _mask_landsat_clouds(image):
    """QA_PIXEL bits per USGS Collection 2 Level-2: bit 3 = cloud, bit 4 = cloud shadow."""
    qa = image.select("QA_PIXEL")
    cloud_bit = 1 << 3
    shadow_bit = 1 << 4
    mask = qa.bitwiseAnd(cloud_bit).eq(0).And(qa.bitwiseAnd(shadow_bit).eq(0))
    return image.updateMask(mask)


def _landsat_lst_celsius(image):
    """ST_B10 scale/offset per USGS Collection 2 Level-2 docs, Kelvin -> Celsius."""
    kelvin = image.select("ST_B10").multiply(0.00341802).add(149.0)
    celsius = kelvin.subtract(273.15).rename("lst_celsius")
    return image.addBands(celsius)


def _mask_sentinel2_clouds(image):
    """QA60 bits: bit 10 = opaque cloud, bit 11 = cirrus. Simple/standard mask -
    not as robust as a probabilistic cloud score, but consistent with this
    pipeline's existing style of pragmatic, documented proxies (see
    traffic_density in ARCHITECTURE.md)."""
    qa = image.select("QA60")
    cloud_bit = 1 << 10
    cirrus_bit = 1 << 11
    mask = qa.bitwiseAnd(cloud_bit).eq(0).And(qa.bitwiseAnd(cirrus_bit).eq(0))
    return image.updateMask(mask)


def _sentinel2_ndvi(image):
    ndvi = image.normalizedDifference(["B8", "B4"]).rename("ndvi")
    return image.addBands(ndvi)


def fetch_lst_ndvi_real(cells) -> dict[tuple[int, int], dict]:
    """Real implementation: Landsat 8/9 Collection 2 Level-2 surface temperature
    (cloud-masked, converted to Celsius) and Sentinel-2 NDVI (cloud-masked),
    both as median composites over a trailing 180-day window - wide enough to
    collect clear-sky passes even accounting for monsoon cloud cover over
    part of the range. Reduced over every cell in a single batched
    reduceRegions() call rather than one request per cell."""
    import ee

    service_account_json = os.environ["GEE_SERVICE_ACCOUNT_JSON"]
    info = json.loads(service_account_json)
    credentials = ee.ServiceAccountCredentials(info["client_email"], key_data=service_account_json)
    ee.Initialize(credentials)

    end_date = ee.Date(datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    start_date = end_date.advance(-180, "day")

    min_lon = min(c.minx for c in cells)
    min_lat = min(c.miny for c in cells)
    max_lon = max(c.maxx for c in cells)
    max_lat = max(c.maxy for c in cells)
    region = ee.Geometry.Rectangle([min_lon, min_lat, max_lon, max_lat])

    landsat = (
        ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
        .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
        .filterDate(start_date, end_date)
        .filterBounds(region)
        .map(_mask_landsat_clouds)
        .map(_landsat_lst_celsius)
    )
    lst_image = landsat.select("lst_celsius").median()

    sentinel = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterDate(start_date, end_date)
        .filterBounds(region)
        .map(_mask_sentinel2_clouds)
        .map(_sentinel2_ndvi)
    )
    ndvi_image = sentinel.select("ndvi").median()

    combined = lst_image.addBands(ndvi_image)

    features = [
        ee.Feature(ee.Geometry.Rectangle([c.minx, c.miny, c.maxx, c.maxy]), {"row": c.row, "col": c.col})
        for c in cells
    ]
    cells_fc = ee.FeatureCollection(features)

    reduced = combined.reduceRegions(collection=cells_fc, reducer=ee.Reducer.mean(), scale=30)

    result: dict[tuple[int, int], dict] = {}
    for feature in reduced.getInfo()["features"]:
        props = feature["properties"]
        row = int(props["row"])
        col = int(props["col"])
        lst = props.get("lst_celsius")
        ndvi = props.get("ndvi")
        result[(row, col)] = {
            "lst_celsius": round(lst, 2) if lst is not None else None,
            "ndvi": round(ndvi, 3) if ndvi is not None else None,
        }
    return result


def fetch_lst_ndvi(cells, rows: int, cols: int, use_mock: bool) -> dict[tuple[int, int], dict]:
    if use_mock:
        return fetch_lst_ndvi_mock(rows, cols)
    return fetch_lst_ndvi_real(cells)