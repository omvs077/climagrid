import type { GridCell } from "./api";

export type InterventionType = "trees" | "cool_roofs" | "reduce_built_up" | "reduce_traffic";

export interface InterventionSettings {
  trees: number; // 0-100 intensity %
  cool_roofs: number;
  reduce_built_up: number;
  reduce_traffic: number;
}

export const DEFAULT_INTERVENTIONS: InterventionSettings = {
  trees: 0,
  cool_roofs: 0,
  reduce_built_up: 0,
  reduce_traffic: 0,
};

export interface CellEstimate {
  grid_id: string;
  baseline_lst: number | null;
  estimated_lst: number | null;
  delta: number;
}

/**
 * Illustrative, non-scientific sensitivity coefficients based on general
 * trends reported in urban-heat-mitigation literature (tree canopy cover,
 * reflective/"cool" roofing, reduced impervious surface, reduced vehicle
 * density). These are NOT calibrated against real Pune measurements - the
 * simulator is a "what if you explored this" tool, not a predictive model.
 * Max cooling per intervention assumes that intervention applied at 100%
 * intensity across the entire selected area.
 */
export const MAX_COOLING_C: Record<InterventionType, number> = {
  trees: 1.8,
  cool_roofs: 2.0,
  reduce_built_up: 1.2,
  reduce_traffic: 0.5,
};

// Diminishing returns cap when stacking multiple interventions at once -
// a fully "restored" cell doesn't cool indefinitely.
const MAX_TOTAL_COOLING_C = 4.5;

/** The intervention contributing most to the current cooling estimate, or null if none is active. */
export function dominantIntervention(settings: InterventionSettings): InterventionType | null {
  const weighted: [InterventionType, number][] = (Object.keys(MAX_COOLING_C) as InterventionType[]).map((k) => [
    k,
    (settings[k] / 100) * MAX_COOLING_C[k],
  ]);
  const [topType, topValue] = weighted.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
  return topValue > 0 ? topType : null;
}

export function estimateCellDelta(settings: InterventionSettings): number {
  const total =
    (settings.trees / 100) * MAX_COOLING_C.trees +
    (settings.cool_roofs / 100) * MAX_COOLING_C.cool_roofs +
    (settings.reduce_built_up / 100) * MAX_COOLING_C.reduce_built_up +
    (settings.reduce_traffic / 100) * MAX_COOLING_C.reduce_traffic;
  return Math.min(total, MAX_TOTAL_COOLING_C);
}

export function estimateCells(cells: GridCell[], settings: InterventionSettings): CellEstimate[] {
  const delta = estimateCellDelta(settings);
  return cells.map((c) => ({
    grid_id: c.grid_id,
    baseline_lst: c.lst_celsius,
    estimated_lst: c.lst_celsius !== null ? c.lst_celsius - delta : null,
    delta: c.lst_celsius !== null ? -delta : 0,
  }));
}

// GridCell never carries ward_id from the API (spatial_grids.ward_id exists
// in the DB but the /api/v1/grid route does not select it) - "select a
// ward" is resolved via point-in-polygon against the ward's own geometry
// instead of a foreign-key match.
function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInWardGeometry(
  lon: number,
  lat: number,
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown }
): boolean {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as number[][][];
    return pointInRing(lon, lat, rings[0]);
  }
  const polygons = geometry.coordinates as number[][][][];
  return polygons.some((poly) => pointInRing(lon, lat, poly[0]));
}

export interface SimulationSummary {
  cellCount: number;
  avgBaselineLst: number | null;
  avgEstimatedLst: number | null;
  avgDelta: number;
}

export function summarizeEstimates(estimates: CellEstimate[]): SimulationSummary {
  const valid = estimates.filter((e) => e.baseline_lst !== null && e.estimated_lst !== null);
  if (valid.length === 0) {
    return { cellCount: estimates.length, avgBaselineLst: null, avgEstimatedLst: null, avgDelta: 0 };
  }
  const avgBaselineLst = valid.reduce((sum, e) => sum + e.baseline_lst!, 0) / valid.length;
  const avgEstimatedLst = valid.reduce((sum, e) => sum + e.estimated_lst!, 0) / valid.length;
  return {
    cellCount: estimates.length,
    avgBaselineLst,
    avgEstimatedLst,
    avgDelta: avgEstimatedLst - avgBaselineLst,
  };
}
