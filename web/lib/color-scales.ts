export type LayerId = "lst_celsius" | "ndvi" | "built_up_index" | "traffic_density";

export const LAYER_DEFS: { id: LayerId; label: string; unit: string }[] = [
  { id: "lst_celsius", label: "Temperature (LST)", unit: "\u00b0C" },
  { id: "ndvi", label: "Vegetation (NDVI)", unit: "index" },
  { id: "built_up_index", label: "Built-up Density", unit: "index" },
  { id: "traffic_density", label: "Road Density", unit: "index" },
];

// Domain + 3-stop color ramp per layer.
// built_up_index / traffic_density are normalized 0-1 relative to the
// single densest grid cell in the city (see pipeline/sources/overpass.py
// compute_density_by_cell) - NOT small fractions like 0.02-0.05. That
// mismatch was the bug: a too-narrow domain clipped nearly every cell to
// the max color, rendering as one solid block instead of a gradient.
const RAMPS: Record<LayerId, { domain: [number, number, number]; colors: [string, string, string] }> = {
  lst_celsius: { domain: [26, 34, 42], colors: ["#2166ac", "#f7f7f7", "#b2182b"] },
  ndvi: { domain: [0, 0.4, 0.85], colors: ["#a50026", "#ffffbf", "#1a9850"] },
  built_up_index: { domain: [0, 0.3, 1], colors: ["#fff7ec", "#fc8d59", "#7f0000"] },
  traffic_density: { domain: [0, 0.3, 1], colors: ["#ffffe5", "#fe9929", "#993404"] },
};

export function getLayerPaintExpression(layerId: LayerId): unknown {
  const { domain, colors } = RAMPS[layerId];
  return [
    "interpolate",
    ["linear"],
    ["get", "value"],
    domain[0], colors[0],
    domain[1], colors[1],
    domain[2], colors[2],
  ];
}