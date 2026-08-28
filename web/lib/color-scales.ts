export type LayerId = "lst_celsius" | "ndvi" | "built_up_index" | "traffic_density";
export type MapTheme = "light" | "dark";

export const LAYER_DEFS: { id: LayerId; label: string; unit: string }[] = [
  { id: "lst_celsius", label: "Temperature (LST)", unit: "\u00b0C" },
  { id: "ndvi", label: "Vegetation (NDVI)", unit: "index" },
  { id: "built_up_index", label: "Built-up Density", unit: "index" },
  { id: "traffic_density", label: "Road Density", unit: "index" },
];

type Ramp = { domain: [number, number, number]; colors: [string, string, string] };

// Dark-basemap ramps: brighter/more saturated so they read against a near-black background.
const RAMPS_DARK: Record<LayerId, Ramp> = {
  lst_celsius: { domain: [31, 36.5, 42], colors: ["#2166ac", "#f7f7f7", "#b2182b"] },
  ndvi: { domain: [0, 0.4, 0.85], colors: ["#a50026", "#ffffbf", "#1a9850"] },
  built_up_index: { domain: [0, 0.3, 1], colors: ["#f2f0f7", "#9e9ac8", "#4a1486"] },
  traffic_density: { domain: [0, 0.3, 1], colors: ["#f0f9e8", "#43a2ca", "#0868ac"] },
};

// Light-basemap ramps: deeper, more muted tones. Reusing the dark-mode ramp
// on a pale Positron basemap washed out and made place-name labels unreadable.
const RAMPS_LIGHT: Record<LayerId, Ramp> = {
  lst_celsius: { domain: [31, 36.5, 42], colors: ["#3b4cc0", "#f0e68c", "#b40426"] },
  ndvi: { domain: [0, 0.4, 0.85], colors: ["#8c510a", "#d9d9d9", "#01665e"] },
  built_up_index: { domain: [0, 0.3, 1], colors: ["#c6c0dd", "#7a5ea8", "#2d0057"] },
  traffic_density: { domain: [0, 0.3, 1], colors: ["#a6d3d9", "#2f8fae", "#08476b"] },
};

const GRID_FILL_OPACITY: Record<MapTheme, number> = { dark: 0.6, light: 0.42 };
const WARD_FILL_OPACITY: Record<MapTheme, number> = { dark: 0.35, light: 0.3 };

export function getGridFillOpacity(theme: MapTheme): number {
  return GRID_FILL_OPACITY[theme];
}
export function getWardFillOpacity(theme: MapTheme): number {
  return WARD_FILL_OPACITY[theme];
}

function ramps(theme: MapTheme): Record<LayerId, Ramp> {
  return theme === "light" ? RAMPS_LIGHT : RAMPS_DARK;
}

export function getLayerRamp(layerId: LayerId, theme: MapTheme = "dark"): Ramp {
  return ramps(theme)[layerId];
}

// Hex -> [r,g,b] once per call; small enough that a lookup cache isn't
// worth the complexity here (raster canvas rendering calls this per pixel,
// but only 3 colors per layer, so the browser's own JIT handles it fine).
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Plain-JS equivalent of getLayerPaintExpression's MapLibre "interpolate"/
 * "linear" expression - used by canvas-based rendering (RasterLayer) where
 * there's no MapLibre paint pipeline to lean on. Must stay mathematically
 * identical to the MapLibre expression so grid view and smooth view show
 * the same color for the same value.
 */
export function getColorForValue(layerId: LayerId, value: number, theme: MapTheme = "dark"): [number, number, number] {
  const { domain, colors } = getLayerRamp(layerId, theme);
  const rgbs = colors.map(hexToRgb);

  if (value <= domain[0]) return rgbs[0];
  if (value >= domain[2]) return rgbs[2];

  const [lo, mid, hi] = domain;
  const [c0, c1, c2] = rgbs;

  if (value <= mid) {
    const t = (value - lo) / (mid - lo);
    return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
  } else {
    const t = (value - mid) / (hi - mid);
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  }
}

export function getLayerPaintExpression(layerId: LayerId, theme: MapTheme = "dark"): unknown {
  const { domain, colors } = getLayerRamp(layerId, theme);
  return [
    "interpolate",
    ["linear"],
    ["get", "value"],
    domain[0], colors[0],
    domain[1], colors[1],
    domain[2], colors[2],
  ];
}