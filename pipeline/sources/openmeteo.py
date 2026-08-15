"""
Open-Meteo: current weather context for the city (city-level, not per-cell —
used mainly to sanity-check LST against real ambient temp on run day).
"""
from __future__ import annotations

import logging
import requests

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
HEADERS = {"User-Agent": "ClimaGrid/0.1 (educational urban-heat project)"}
CONNECT_TIMEOUT_SECONDS = 10
READ_TIMEOUT_SECONDS = 15

logger = logging.getLogger(__name__)


def fetch_current_weather(lat: float, lon: float) -> dict | None:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m",
    }
    try:
        response = requests.get(
            OPEN_METEO_URL,
            params=params,
            headers=HEADERS,
            timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Open-Meteo request failed: %s", exc)
        return None

    current = payload.get("current")
    if not isinstance(current, dict):
        logger.warning("Open-Meteo response shape unexpected, discarding")
        return None
    return current
