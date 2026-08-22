"use client";

import { useEffect, useState } from "react";
import { Map, MapControls, useMap } from "@/components/ui/map";
import { Card } from "@/components/ui/card";
import { fetchGrid, fetchVulnerability, type GridResponse, type VulnerabilityResponse } from "@/lib/api";
import { getLayerPaintExpression, LAYER_DEFS, type LayerId } from "@/lib/color-scales";

const PUNE_CENTER: [number, number] = [73.845, 18.525];
const PUNE_BBOX = "73.74,18.43,73.95,18.62";

const GRID_SOURCE_ID = "climagrid-grid";
const GRID_FILL_LAYER_ID = "climagrid-grid-fill";
const GRID_LINE_LAYER_ID = "climagrid-grid-line";

const WARD_SOURCE_ID = "climagrid-wards";
const WARD_FILL_LAYER_ID = "climagrid-wards-fill";
const WARD_LINE_LAYER_ID = "climagrid-wards-line";

const HVI_DOMAIN: [number, number, number] = [0.2, 0.4, 0.6];
const HVI_COLORS: [string, string, string] = ["#ffffb2", "#fd8d3c", "#bd0026"];

function getFirstLabelLayerId(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  const symbolLayer = layers.find((l) => l.type === "symbol");
  return symbolLayer?.id;
}

function GridLayer({ layerId, grid }: { layerId: LayerId; grid: GridResponse | null }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded || !grid) return;

    const featureCollection = {
      type: "FeatureCollection" as const,
      features: grid.cells
        .filter((c) => c[layerId] !== null)
        .map((c) => ({
          type: "Feature" as const,
          properties: { value: c[layerId] },
          geometry: c.geometry,
        })),
    };

    const source = map.getSource(GRID_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(featureCollection as GeoJSON.FeatureCollection);
    } else {
      map.addSource(GRID_SOURCE_ID, { type: "geojson", data: featureCollection as GeoJSON.FeatureCollection });
      const beforeId = getFirstLabelLayerId(map);
      map.addLayer({
        id: GRID_FILL_LAYER_ID,
        type: "fill",
        source: GRID_SOURCE_ID,
        paint: { "fill-opacity": 0.6 },
      }, beforeId);
      map.addLayer({
        id: GRID_LINE_LAYER_ID,
        type: "line",
        source: GRID_SOURCE_ID,
        paint: { "line-color": "rgba(0,0,0,0.08)", "line-width": 0.5 },
      }, beforeId);
    }
  }, [map, isLoaded, grid, layerId]);

  useEffect(() => {
    if (!map || !map.getLayer(GRID_FILL_LAYER_ID)) return;
    map.setPaintProperty(GRID_FILL_LAYER_ID, "fill-color", getLayerPaintExpression(layerId) as never);
  }, [map, layerId]);

  useEffect(() => {
    return () => {
      if (!map) return;
      [GRID_FILL_LAYER_ID, GRID_LINE_LAYER_ID].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(GRID_SOURCE_ID)) map.removeSource(GRID_SOURCE_ID);
    };
  }, [map]);

  return null;
}

/**
 * Ward-level HVI choropleth overlay - independent on/off toggle, sits above
 * whichever base grid layer is active.
 */
function VulnerabilityLayer({ visible, wards }: { visible: boolean; wards: VulnerabilityResponse | null }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded || !wards) return;

    const featureCollection = {
      type: "FeatureCollection" as const,
      features: wards.wards.map((w) => ({
        type: "Feature" as const,
        properties: { hvi: w.hvi_score, ward_id: w.ward_id },
        geometry: w.geometry,
      })),
    };

    if (map.getSource(WARD_SOURCE_ID)) {
      (map.getSource(WARD_SOURCE_ID) as maplibregl.GeoJSONSource).setData(
        featureCollection as GeoJSON.FeatureCollection
      );
    } else {
      map.addSource(WARD_SOURCE_ID, { type: "geojson", data: featureCollection as GeoJSON.FeatureCollection });
      const beforeId = getFirstLabelLayerId(map);
      map.addLayer({
        id: WARD_FILL_LAYER_ID,
        type: "fill",
        source: WARD_SOURCE_ID,
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["get", "hvi"],
            HVI_DOMAIN[0], HVI_COLORS[0],
            HVI_DOMAIN[1], HVI_COLORS[1],
            HVI_DOMAIN[2], HVI_COLORS[2],
          ] as never,
          "fill-opacity": 0.35,
        },
      }, beforeId);
      map.addLayer({
        id: WARD_LINE_LAYER_ID,
        type: "line",
        source: WARD_SOURCE_ID,
        paint: { "line-color": "#1f2937", "line-width": 1.5 },
      }, beforeId);
    }
  }, [map, isLoaded, wards]);

  useEffect(() => {
    if (!map) return;
    [WARD_FILL_LAYER_ID, WARD_LINE_LAYER_ID].forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    });
  }, [map, visible]);

  useEffect(() => {
    return () => {
      if (!map) return;
      [WARD_FILL_LAYER_ID, WARD_LINE_LAYER_ID].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(WARD_SOURCE_ID)) map.removeSource(WARD_SOURCE_ID);
    };
  }, [map]);

  return null;
}

export function ClimateMap() {
  const [activeLayer, setActiveLayer] = useState<LayerId>("lst_celsius");
  const [showVulnerability, setShowVulnerability] = useState(false);
  const [grid, setGrid] = useState<GridResponse | null>(null);
  const [vulnerability, setVulnerability] = useState<VulnerabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchGrid(PUNE_BBOX, "pune"), fetchVulnerability("pune")])
      .then(([gridData, vulnData]) => {
        if (!cancelled) {
          setGrid(gridData);
          setVulnerability(vulnData);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <Card className="h-full w-full p-0 overflow-hidden">
        <Map center={PUNE_CENTER} zoom={11.5}>
          <MapControls />
          <GridLayer layerId={activeLayer} grid={grid} />
          <VulnerabilityLayer visible={showVulnerability} wards={vulnerability} />
        </Map>
      </Card>

      <div className="absolute top-4 left-4 z-10 flex flex-col gap-1 rounded-lg border bg-background/90 p-3 shadow-sm backdrop-blur">
        <span className="mb-1 text-xs font-medium text-muted-foreground">Layer</span>
        {LAYER_DEFS.map((l) => (
          <button
            key={l.id}
            onClick={() => setActiveLayer(l.id)}
            className={`rounded px-2 py-1 text-left text-sm transition-colors ${
              activeLayer === l.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {l.label}
          </button>
        ))}

        <div className="mt-2 border-t pt-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showVulnerability}
              onChange={(e) => setShowVulnerability(e.target.checked)}
            />
            Ward Vulnerability (HVI)
          </label>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60">
          <span className="text-sm text-muted-foreground">Loading Pune climate data...</span>
        </div>
      )}
      {error && (
        <div className="absolute bottom-4 left-4 z-20 rounded bg-destructive px-3 py-2 text-sm text-destructive-foreground">
          Failed to load data: {error}
        </div>
      )}
    </div>
  );
}