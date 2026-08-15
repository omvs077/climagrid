"use client";

import { useEffect, useState } from "react";
import { Map, MapControls, useMap } from "@/components/ui/map";
import { Card } from "@/components/ui/card";
import { fetchGrid, type GridResponse } from "@/lib/api";
import { getLayerPaintExpression, LAYER_DEFS, type LayerId } from "@/lib/color-scales";

const PUNE_CENTER: [number, number] = [73.845, 18.525];
const PUNE_BBOX = "73.74,18.43,73.95,18.62";

const SOURCE_ID = "climagrid-grid";
const FILL_LAYER_ID = "climagrid-grid-fill";
const LINE_LAYER_ID = "climagrid-grid-line";

/**
 * Renders the grid as a single GeoJSON source + fill/line layer pair on the
 * raw MapLibre instance (via useMap()) - not DOM markers. With ~400 cells
 * this keeps rendering on the WebGL canvas, matching mapcn's own guidance
 * for anything beyond a handful of features.
 */
function GridLayer({ layerId, grid }: { layerId: LayerId; grid: GridResponse | null }) {
  const { map, isLoaded } = useMap();

  // Create the source/layers once map is ready and data has arrived.
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

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(featureCollection as GeoJSON.FeatureCollection);
    } else {
      map.addSource(SOURCE_ID, { type: "geojson", data: featureCollection as GeoJSON.FeatureCollection });
      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: { "fill-opacity": 0.72 },
      });
      map.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: { "line-color": "rgba(0,0,0,0.08)", "line-width": 0.5 },
      });
    }
  }, [map, isLoaded, grid, layerId]);

  // Swap the fill color expression whenever the active layer changes -
  // cheap, no need to rebuild the source.
  useEffect(() => {
    if (!map || !map.getLayer(FILL_LAYER_ID)) return;
    map.setPaintProperty(FILL_LAYER_ID, "fill-color", getLayerPaintExpression(layerId) as never);
  }, [map, layerId]);

  // Clean up on unmount only - avoids flicker when just switching layers.
  useEffect(() => {
    return () => {
      if (!map) return;
      [FILL_LAYER_ID, LINE_LAYER_ID].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map]);

  return null;
}

export function ClimateMap() {
  const [activeLayer, setActiveLayer] = useState<LayerId>("lst_celsius");
  const [grid, setGrid] = useState<GridResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGrid(PUNE_BBOX, "pune")
      .then((data) => {
        if (!cancelled) setGrid(data);
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