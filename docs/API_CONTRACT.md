# ClimaGrid — API Contract

All endpoints are **GET only**. There are no write endpoints in this system — that's not an oversight, it's the design (see `PRD.md §3`, `SECURITY.md §1`).

Base path: `/api/v1`

## Conventions

- All responses: `application/json`
- Errors use a consistent envelope:
  ```json
  { "error": { "code": "invalid_bbox", "message": "bbox exceeds maximum area of 2500 km²" } }
  ```
- All endpoints are rate-limited by IP (see `SECURITY.md §2`); throttled responses return `429` with a `Retry-After` header.
- All endpoints are cacheable and served with `Cache-Control` headers (data updates on the pipeline's schedule, not in real time — safe to cache for hours).
- `city` defaults to the configured demo city (`pune`) if omitted; the param exists so the schema doesn't need to change when multi-city ships later.

## Endpoints

### `GET /api/v1/grid`
Returns grid cells intersecting a bounding box, with layer values.

**Query params**
| Param | Type | Required | Notes |
|---|---|---|---|
| `bbox` | `minLon,minLat,maxLon,maxLat` | yes | Capped server-side to a max area to prevent a single request from pulling the whole city at max zoom (DoS-by-payload-size prevention) |
| `city` | string | no | defaults to demo city |
| `layers` | comma list: `lst,ndvi,built_up,traffic` | no | defaults to all |

**Response**
```json
{
  "city": "pune",
  "pipeline_run_id": "…",
  "computed_at": "2026-08-01T00:00:00Z",
  "cells": [
    { "grid_id": "…", "geometry": { "type": "Polygon", "coordinates": [...] },
      "lst_celsius": 38.2, "ndvi": 0.21, "built_up_index": 0.74, "traffic_density": 0.55 }
  ]
}
```

### `GET /api/v1/vulnerability`
Returns ward-level HVI choropleth data.

**Query params:** `city` (optional)

**Response**
```json
{
  "city": "pune",
  "model_version": "hvi-v1",
  "wards": [
    { "ward_id": "PMC-12", "hvi_score": 0.68, "geometry": { "type": "MultiPolygon", "coordinates": [...] } }
  ]
}
```

### `GET /api/v1/meta`
Returns available cities, layer definitions, last pipeline run status/timestamp — powers the UI's legend and city selector (even though only one city ships in v1, the endpoint is shaped for that future without adding write surface now).

## Explicitly Not Implemented (and why)

| Would-be endpoint | Why it doesn't exist |
|---|---|
| `POST /sensors/telemetry` | No crowd sensors in this scope — removes the highest-risk surface from the original design |
| `POST /interventions` | Mitigation simulator is client-side only; nothing to save server-side |
| Any `/auth/*` | No accounts |
| `POST /simulator/calc` | Calculation happens in the browser, not the server |
