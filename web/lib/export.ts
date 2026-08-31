import type { GridCell, VulnerabilityWard } from "@/lib/api";
import type { LayerId } from "@/lib/color-scales";

function triggerDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function cellCentroid(cell: GridCell): [number, number] {
  const ring = cell.geometry.coordinates[0];
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

const LAYER_CSV_HEADERS: Record<LayerId, string> = {
  lst_celsius: "temperature_celsius",
  ndvi: "ndvi",
  built_up_index: "built_up_density",
  traffic_density: "road_density",
};

export function exportGridGeoJSON(cells: GridCell[], layers: LayerId[]) {
  const featureCollection = {
    type: "FeatureCollection" as const,
    features: cells.map((c) => ({
      type: "Feature" as const,
      geometry: c.geometry,
      properties: Object.fromEntries(layers.map((l) => [l, c[l]])),
    })),
  };
  triggerDownload(
    JSON.stringify(featureCollection, null, 2),
    `climagrid-grid-${Date.now()}.geojson`,
    "application/geo+json"
  );
}

export function exportGridCSV(cells: GridCell[], layers: LayerId[], includeLocation: boolean) {
  const headers = [
    "grid_id",
    ...(includeLocation ? ["centroid_lon", "centroid_lat"] : []),
    ...layers.map((l) => LAYER_CSV_HEADERS[l]),
  ];
  const rows = cells.map((c) => {
    const [lon, lat] = includeLocation ? cellCentroid(c) : [null, null];
    return [
      c.grid_id,
      ...(includeLocation ? [lon, lat] : []),
      ...layers.map((l) => c[l] ?? ""),
    ].join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  triggerDownload(csv, `climagrid-grid-${Date.now()}.csv`, "text/csv");
}

export function exportWardsGeoJSON(wards: VulnerabilityWard[]) {
  const featureCollection = {
    type: "FeatureCollection" as const,
    features: wards.map((w) => ({
      type: "Feature" as const,
      geometry: w.geometry,
      properties: { ward_id: w.ward_id, hvi_score: w.hvi_score },
    })),
  };
  triggerDownload(
    JSON.stringify(featureCollection, null, 2),
    `climagrid-wards-${Date.now()}.geojson`,
    "application/geo+json"
  );
}

export function exportWardsCSV(wards: VulnerabilityWard[]) {
  const headers = ["ward_id", "hvi_score"];
  const rows = wards.map((w) => [w.ward_id, w.hvi_score].join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  triggerDownload(csv, `climagrid-wards-${Date.now()}.csv`, "text/csv");
}