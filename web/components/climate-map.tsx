"use client";

import { useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Map, MapControls, useMap } from "@/components/ui/map";
import { Card } from "@/components/ui/card";
import { fetchGrid, fetchVulnerability, type GridResponse, type VulnerabilityResponse } from "@/lib/api";
import { getLayerPaintExpression, LAYER_DEFS, getGridFillOpacity, getWardFillOpacity, type LayerId, type MapTheme } from "@/lib/color-scales";
import { Legend, HviLegend } from "@/components/legend";

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

// Carto's default Positron/Dark Matter styles are intentionally near-monochrome,
// which made roads and buildings almost invisible against the fill layers.
// Voyager keeps the same clean cartography but with real color differentiation.
const MAP_STYLES = {
  light: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};

function getFirstLabelLayerId(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  const symbolLayer = layers.find((l) => l.type === "symbol");
  return symbolLayer?.id;
}

/**
 * Carto's dark-matter and (to a lesser extent) light styles render roads,
 * buildings, and landuse fills so close to the background color they are
 * nearly invisible. This boosts contrast on those layers at runtime and
 * explicitly enforces label color per theme, since layer IDs can vary
 * slightly between style versions - matching is done by pattern, not by
 * hardcoding exact IDs.
 */
function enhanceBasemapContrast(map: maplibregl.Map, theme: MapTheme) {
  const style = map.getStyle();
  if (!style?.layers) return;

  const isDark = theme === "dark";

  for (const layer of style.layers) {
    try {
      if (layer.type === "fill" && /building/i.test(layer.id)) {
        map.setPaintProperty(
          layer.id,
          "fill-color",
          isDark ? "rgba(58,58,64,0.9)" : "rgba(200,196,188,0.9)"
        );
        map.setPaintProperty(
          layer.id,
          "fill-outline-color",
          isDark ? "rgba(95,95,102,0.6)" : "rgba(150,146,138,0.7)"
        );
      } else if (layer.type === "fill" && /landuse|landcover|residential/i.test(layer.id)) {
        map.setPaintProperty(layer.id, "fill-opacity", isDark ? 0.55 : 0.6);
      } else if (layer.type === "line" && /highway|road|street|transportation/i.test(layer.id)) {
        map.setPaintProperty(
          layer.id,
          "line-color",
          isDark ? "rgba(150,150,156,0.85)" : "rgba(255,255,255,0.9)"
        );
      } else if (layer.type === "symbol") {
        // No ID filtering here: place names, street names, and POI labels
        // all use different, inconsistent ID patterns across style versions
        // (e.g. "highway_name_other" has neither "place" nor "label" in its
        // ID), so every symbol layer gets the same bold, high-contrast text
        // treatment rather than trying to guess which IDs are labels.
        map.setPaintProperty(layer.id, "text-color", isDark ? "#ffffff" : "#000000");
        map.setPaintProperty(layer.id, "text-halo-color", isDark ? "#000000" : "#ffffff");
        map.setPaintProperty(layer.id, "text-halo-width", 1.6);
        map.setPaintProperty(layer.id, "text-halo-blur", 0);
      }
    } catch {
      // property not applicable to this layer type/id - skip silently
    }
  }
}

function BasemapEnhancer({ theme }: { theme: MapTheme }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;
    enhanceBasemapContrast(map, theme);
  }, [map, isLoaded, theme]);

  return null;
}


function GridLayer({ layerId, grid, theme }: { layerId: LayerId; grid: GridResponse | null; theme: MapTheme }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded || !grid) return;

    const featureCollection = {
      type: "FeatureCollection" as const,
      features: grid.cells
        .filter((c) => c[layerId] !== null)
        .map((c) => ({
          type: "Feature" as const,
          properties: {
            value: c[layerId],
            lst_celsius: c.lst_celsius,
            ndvi: c.ndvi,
            built_up_index: c.built_up_index,
            traffic_density: c.traffic_density,
          },
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
        paint: { "fill-opacity": getGridFillOpacity(theme) },
      }, beforeId);
      map.addLayer({
        id: GRID_LINE_LAYER_ID,
        type: "line",
        source: GRID_SOURCE_ID,
        paint: { "line-color": "rgba(0,0,0,0.08)", "line-width": 0.5 },
      }, beforeId);
    }
  }, [map, isLoaded, grid, layerId, theme]);

  useEffect(() => {
    if (!map || !map.getLayer(GRID_FILL_LAYER_ID)) return;
    map.setPaintProperty(GRID_FILL_LAYER_ID, "fill-color", getLayerPaintExpression(layerId, theme) as never);
  }, [map, layerId, theme]);

  useEffect(() => {
    if (!map || !map.getLayer(GRID_FILL_LAYER_ID)) return;
    map.setPaintProperty(GRID_FILL_LAYER_ID, "fill-opacity", getGridFillOpacity(theme));
  }, [map, theme]);

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
function VulnerabilityLayer({ visible, wards, theme }: { visible: boolean; wards: VulnerabilityResponse | null; theme: MapTheme }) {
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
      const initialVisibility = visible ? "visible" : "none";
      map.addLayer({
        id: WARD_FILL_LAYER_ID,
        type: "fill",
        source: WARD_SOURCE_ID,
        layout: { visibility: initialVisibility },
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["get", "hvi"],
            HVI_DOMAIN[0], HVI_COLORS[0],
            HVI_DOMAIN[1], HVI_COLORS[1],
            HVI_DOMAIN[2], HVI_COLORS[2],
          ] as never,
          "fill-opacity": getWardFillOpacity(theme),
        },
      }, beforeId);
      map.addLayer({
        id: WARD_LINE_LAYER_ID,
        type: "line",
        source: WARD_SOURCE_ID,
        layout: { visibility: initialVisibility },
        paint: { "line-color": "#1f2937", "line-width": 1.5 },
      }, beforeId);
    }
  }, [map, isLoaded, wards, visible, theme]);

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

/**
 * Single shared hover popup. Queries whichever data layers are currently
 * rendered at the cursor position and merges grid + ward info into one
 * card, instead of two independent popups that could overlap.
 */
function HoverPopup({ enabled, showVulnerability }: { enabled: boolean; showVulnerability: boolean }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

    const fmt = (v: number | null | undefined, digits: number) =>
      v === null || v === undefined ? "\u2013" : v.toFixed(digits);

    const cardStyle =
      "font-size:12px;line-height:1.6;min-width:160px;background:#18181b;color:#f4f4f5;" +
      "border:1px solid #3f3f46;border-radius:8px;padding:10px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.35);";

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (!enabled) {
        popup.remove();
        return;
      }

      const layersToQuery = [GRID_FILL_LAYER_ID];
      if (showVulnerability) layersToQuery.push(WARD_FILL_LAYER_ID);

      const existing = layersToQuery.filter((id) => map.getLayer(id));
      if (existing.length === 0) return;

      const features = map.queryRenderedFeatures(e.point, { layers: existing });
      if (features.length === 0) {
        map.getCanvas().style.cursor = "";
        popup.remove();
        return;
      }

      map.getCanvas().style.cursor = "pointer";

      const gridFeature = features.find((f) => f.layer.id === GRID_FILL_LAYER_ID);
      const wardFeature = features.find((f) => f.layer.id === WARD_FILL_LAYER_ID);

      let html = `<div style="${cardStyle}">`;
      if (gridFeature) {
        const p = gridFeature.properties as Record<string, number | null>;
        html += `
          <div><strong>Temperature:</strong> ${fmt(p.lst_celsius, 1)}\u00b0C</div>
          <div><strong>Vegetation (NDVI):</strong> ${fmt(p.ndvi, 2)}</div>
          <div><strong>Built-up density:</strong> ${fmt(p.built_up_index, 2)}</div>
          <div><strong>Road density:</strong> ${fmt(p.traffic_density, 2)}</div>
        `;
      }
      if (wardFeature) {
        const p = wardFeature.properties as { ward_id: string; hvi: number };
        if (gridFeature) html += `<div style="margin:6px 0;border-top:1px solid #3f3f46;"></div>`;
        html += `
          <div><strong>Ward:</strong> ${p.ward_id}</div>
          <div><strong>HVI score:</strong> ${p.hvi.toFixed(3)}</div>
        `;
      }
      html += `</div>`;

      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    };

    map.on("mousemove", handleMouseMove);
    map.getCanvas().addEventListener("mouseleave", handleMouseLeave);

    return () => {
      map.off("mousemove", handleMouseMove);
      map.getCanvas().removeEventListener("mouseleave", handleMouseLeave);
      popup.remove();
    };
  }, [map, isLoaded, enabled, showVulnerability]);

  useEffect(() => {
    if (!enabled && map) map.getCanvas().style.cursor = "";
  }, [enabled, map]);

  return null;
}

export function ClimateMap() {
  const [activeLayer, setActiveLayer] = useState<LayerId>("lst_celsius");
  const [showVulnerability, setShowVulnerability] = useState(false);
  const [showHoverInfo, setShowHoverInfo] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
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
        <Map center={PUNE_CENTER} zoom={11.5} theme={theme} styles={MAP_STYLES}>
          <MapControls />
          <GridLayer layerId={activeLayer} grid={grid} theme={theme} />
          <VulnerabilityLayer visible={showVulnerability} wards={vulnerability} theme={theme} />
          <HoverPopup enabled={showHoverInfo} showVulnerability={showVulnerability} />
          <BasemapEnhancer theme={theme} />
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

        <div className="mt-2 border-t pt-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showHoverInfo}
              onChange={(e) => setShowHoverInfo(e.target.checked)}
            />
            Show details on hover
          </label>
        </div>

        <div className="mt-2 border-t pt-2">
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          >
            {theme === "dark" ? "Switch to Light Map" : "Switch to Dark Map"}
          </button>
        </div>
      </div>

      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        <Legend
          layerId={activeLayer}
          unit={LAYER_DEFS.find((l) => l.id === activeLayer)?.unit ?? ""}
          theme={theme}
        />
        {showVulnerability && <HviLegend domain={HVI_DOMAIN} colors={HVI_COLORS} />}
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
