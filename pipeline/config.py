import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL", "")
GEE_SERVICE_ACCOUNT_JSON = os.environ.get("GEE_SERVICE_ACCOUNT_JSON", "")
DEMO_CITY = os.environ.get("DEMO_CITY", "pune")

# City bounding boxes: (min_lon, min_lat, max_lon, max_lat)
# Single-demo-city scope per PRD.md §1 — add more here if scope expands.
CITY_BBOXES = {
    "pune": (73.74, 18.43, 73.95, 18.62),
}

# Grid cell size in degrees (~1km near this latitude).
GRID_CELL_SIZE_DEG = 0.01

# Grid cells per side aggregated into one "ward" for vulnerability_scores.
# Placeholder simplification — real ward boundaries would come from OSM
# admin polygons or a municipal shapefile in a future iteration.
WARD_BLOCK_SIZE = 4

MODEL_VERSION = "hvi-v1"


def get_bbox(city: str) -> tuple[float, float, float, float]:
    try:
        return CITY_BBOXES[city]
    except KeyError:
        raise ValueError(f"Unknown city '{city}'. Configured: {list(CITY_BBOXES)}")
