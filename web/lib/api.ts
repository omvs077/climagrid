export interface GridCell {
  grid_id: string;
  geometry: { type: "Polygon"; coordinates: number[][][] };
  lst_celsius: number | null;
  ndvi: number | null;
  built_up_index: number | null;
  traffic_density: number | null;
}

export interface GridResponse {
  city: string;
  pipeline_run_id: string | null;
  cells: GridCell[];
}

export interface VulnerabilityWard {
  ward_id: string;
  hvi_score: number;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

export interface VulnerabilityResponse {
  city: string;
  model_version: string | null;
  wards: VulnerabilityWard[];
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export function fetchGrid(bbox: string, city: string) {
  return apiFetch<GridResponse>(`/api/v1/grid?bbox=${encodeURIComponent(bbox)}&city=${encodeURIComponent(city)}`);
}

export function fetchVulnerability(city: string) {
  return apiFetch<VulnerabilityResponse>(`/api/v1/vulnerability?city=${encodeURIComponent(city)}`);
}