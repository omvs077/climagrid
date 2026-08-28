"""
Inverse-distance-weighted (IDW) interpolation with a Gaussian smoothing
pass, producing a smooth raster surface from the discrete grid cells for
each data layer. Raw IDW output has a well-known "bullseye" artifact -
visible spikes centered on each sample point - which real heatmap tools
avoid by blurring the result afterward rather than relying on IDW alone.
Powers the "Smooth view" toggle in the frontend; the discrete grid (with
hover popups) remains the source of truth for exact readings.
"""
from __future__ import annotations
import numpy as np

RASTER_TARGET_LONG_SIDE = 300  # samples along the longer bbox dimension
IDW_POWER = 2.0
SMOOTHING_SIGMA = 6.0  # Gaussian blur std-dev, in raster pixels
ROW_CHUNK_SIZE = 20  # bounds peak memory regardless of raster resolution


def _raster_dims(bbox: tuple[float, float, float, float]) -> tuple[int, int]:
    min_lon, min_lat, max_lon, max_lat = bbox
    width = max_lon - min_lon
    height = max_lat - min_lat
    if width >= height:
        cols = RASTER_TARGET_LONG_SIDE
        rows = max(2, round(RASTER_TARGET_LONG_SIDE * height / width))
    else:
        rows = RASTER_TARGET_LONG_SIDE
        cols = max(2, round(RASTER_TARGET_LONG_SIDE * width / height))
    return rows, cols


def _idw_chunk(
    mesh_lon_chunk: np.ndarray,
    mesh_lat_chunk: np.ndarray,
    sample_lons: np.ndarray,
    sample_lats: np.ndarray,
    sample_vals: np.ndarray,
) -> np.ndarray:
    d_lon = mesh_lon_chunk[:, :, None] - sample_lons[None, None, :]
    d_lat = mesh_lat_chunk[:, :, None] - sample_lats[None, None, :]
    dist = np.sqrt(d_lon**2 + d_lat**2)

    exact_match = dist == 0
    with np.errstate(divide="ignore"):
        weights = 1.0 / np.power(dist, IDW_POWER)
    weights[exact_match] = 0.0

    weight_sum = weights.sum(axis=2)
    weighted_vals = (weights * sample_vals[None, None, :]).sum(axis=2)
    with np.errstate(invalid="ignore", divide="ignore"):
        result = weighted_vals / weight_sum

    any_exact = exact_match.any(axis=2)
    if any_exact.any():
        exact_idx = np.argmax(exact_match, axis=2)
        result = np.where(any_exact, sample_vals[exact_idx], result)

    return result


def _gaussian_kernel1d(sigma: float) -> np.ndarray:
    radius = max(1, int(round(3 * sigma)))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-0.5 * (x / sigma) ** 2)
    return kernel / kernel.sum()


def _convolve_axis_reflect(arr: np.ndarray, kernel: np.ndarray, axis: int) -> np.ndarray:
    """1D convolution with edge-reflecting padding instead of NumPy's
    default zero-padding. Zero-padding pulls boundary pixels toward 0
    during blur, which visibly distorts edge colors (e.g. real values
    ~35 blending toward 0 renders as artificially "cold" blue near the
    raster's border) - reflecting real edge values avoids that."""
    radius = (len(kernel) - 1) // 2
    pad_width = [(0, 0)] * arr.ndim
    pad_width[axis] = (radius, radius)
    padded = np.pad(arr, pad_width, mode="reflect")
    return np.apply_along_axis(lambda m: np.convolve(m, kernel, mode="valid"), axis=axis, arr=padded)


def _smooth(grid: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur - convolve rows, then columns. Softens the
    per-sample-point spikes IDW produces into continuous, professional-
    looking gradients instead of a dotted/bullseye texture."""
    kernel = _gaussian_kernel1d(sigma)
    blurred = _convolve_axis_reflect(grid, kernel, axis=1)
    blurred = _convolve_axis_reflect(blurred, kernel, axis=0)
    return blurred


def interpolate_layer(
    points: list[tuple[float, float, float]],
    bbox: tuple[float, float, float, float],
) -> dict:
    """
    points: list of (lon, lat, value) - one per grid cell with a non-null
    value for this layer.

    Returns: {"rows", "cols", "bbox", "values"} where "values" is a flat,
    row-major list ready for db.write_interpolated_raster().
    """
    if not points:
        raise ValueError("interpolate_layer requires at least one sample point")

    rows, cols = _raster_dims(bbox)
    min_lon, min_lat, max_lon, max_lat = bbox

    sample_lons = np.array([p[0] for p in points], dtype=np.float32)
    sample_lats = np.array([p[1] for p in points], dtype=np.float32)
    sample_vals = np.array([p[2] for p in points], dtype=np.float32)

    grid_lons = np.linspace(min_lon, max_lon, cols, dtype=np.float32)
    grid_lats = np.linspace(min_lat, max_lat, rows, dtype=np.float32)

    # Process in row-chunks so peak memory stays bounded regardless of
    # raster resolution - a full (rows, cols, n_samples) array at 300
    # target resolution with ~1600 samples would otherwise be several
    # hundred MB per layer.
    result_rows = []
    for start in range(0, rows, ROW_CHUNK_SIZE):
        end = min(start + ROW_CHUNK_SIZE, rows)
        chunk_lats = grid_lats[start:end]
        mesh_lon, mesh_lat = np.meshgrid(grid_lons, chunk_lats)
        chunk_result = _idw_chunk(mesh_lon, mesh_lat, sample_lons, sample_lats, sample_vals)
        result_rows.append(chunk_result)

    result = np.concatenate(result_rows, axis=0).astype(np.float64)
    result = _smooth(result, SMOOTHING_SIGMA)

    flat = np.round(result, 4).flatten(order="C").tolist()
    return {"rows": rows, "cols": cols, "bbox": bbox, "values": flat}