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