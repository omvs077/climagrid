"use client";

import { useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Map, MapControls, useMap } from "@/components/ui/map";
import { Card } from "@/components/ui/card";
import { fetchGrid, fetchVulnerability, fetchRaster, type GridCell, type GridResponse, type VulnerabilityResponse } from "@/lib/api";
import { getColorForValue, LAYER_DEFS, getWardFillOpacity, type LayerId, type MapTheme } from "@/lib/color-scales";
import { Legend, HviLegend } from "@/components/legend";

const PUNE_CENTER: [number, number] = [73.845, 18.525];
const PUNE_BBOX = "73.74,18.43,73.95,18.62";

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
        map.setPaintProperty(layer.id, "fill-color", isDark ? "rgba(58,58,64,0.9)" : "rgba(200,196,188,0.9)");
        map.setPaintProperty(layer.id, "fill-outline-color", isDark ? "rgba(95,95,102,0.6)" : "rgba(150,146,138,0.7)");
      } else if (layer.type === "fill" && /landuse|landcover|residential/i.test(layer.id)) {
        map.setPaintProperty(layer.id, "fill-opacity", isDark ? 0.55 : 0.6);
      } else if (layer.type === "line" && /highway|road|street|transportation/i.test(layer.id)) {
        map.setPaintProperty(layer.id, "line-color", isDark ? "rgba(150,150,156,0.85)" : "rgba(255,255,255,0.9)");
      } else if (layer.type === "symbol") {
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

/**
 * Ward-level HVI choropleth overlay - independent on/off toggle, sits above
 * the smooth heat surface.
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
      (map.getSource(WARD_SOURCE_ID) as maplibregl.GeoJSONSource).setData(featureCollection as GeoJSON.FeatureCollection);
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
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
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

const RASTER_SOURCE_ID = "climagrid-raster";
const RASTER_IMAGE_LAYER_ID = "climagrid-raster-image";
// Dark basemap buildings/roads are already subtle by design - a fully
// opaque raster on top swallows them entirely. Lower opacity in dark mode
// so basemap detail still reads through the color surface.
const RASTER_OPACITY: Record<MapTheme, number> = { dark: 0.62, light: 0.8 };

/**
 * Renders the smooth interpolated heat surface for the active layer - the
 * map's only data visualization now (the discrete grid view was removed;
 * see HoverPopup for how exact per-location values are still surfaced
 * without a visible grid).
 */
function RasterLayer({ layerId, city, theme }: { layerId: LayerId; city: string; theme: MapTheme }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;

    let cancelled = false;

    fetchRaster(city, layerId)
      .then((raster) => {
        if (cancelled || !map) return;

        const { rows, cols, bbox, values } = raster;
        const [minLon, minLat, maxLon, maxLat] = bbox;

        const canvas = document.createElement("canvas");
        canvas.width = cols;
        canvas.height = rows;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const imageData = ctx.createImageData(cols, rows);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const value = values[r * cols + c];
            const [red, green, blue] = getColorForValue(layerId, value, theme);
            const destRow = rows - 1 - r;
            const idx = (destRow * cols + c) * 4;
            imageData.data[idx] = red;
            imageData.data[idx + 1] = green;
            imageData.data[idx + 2] = blue;
            imageData.data[idx + 3] = 230;
          }
        }
        ctx.putImageData(imageData, 0, 0);

        const dataUrl = canvas.toDataURL();
        const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
          [minLon, maxLat],
          [maxLon, maxLat],
          [maxLon, minLat],
          [minLon, minLat],
        ];

        const existingSource = map.getSource(RASTER_SOURCE_ID) as maplibregl.ImageSource | undefined;
        if (existingSource) {
          existingSource.updateImage({ url: dataUrl, coordinates });
        } else {
          map.addSource(RASTER_SOURCE_ID, { type: "image", url: dataUrl, coordinates });
          const beforeId = getFirstLabelLayerId(map);
          map.addLayer(
            { id: RASTER_IMAGE_LAYER_ID, type: "raster", source: RASTER_SOURCE_ID, paint: { "raster-opacity": RASTER_OPACITY[theme] } },
            beforeId
          );
        }
        if (map.getLayer(RASTER_IMAGE_LAYER_ID)) {
          map.setPaintProperty(RASTER_IMAGE_LAYER_ID, "raster-opacity", RASTER_OPACITY[theme]);
        }
      })
      .catch((err) => {
        console.error("Failed to load raster:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [map, isLoaded, layerId, city, theme]);

  useEffect(() => {
    return () => {
      if (!map) return;
      if (map.getLayer(RASTER_IMAGE_LAYER_ID)) map.removeLayer(RASTER_IMAGE_LAYER_ID);
      if (map.getSource(RASTER_SOURCE_ID)) map.removeSource(RASTER_SOURCE_ID);
    };
  }, [map]);

  return null;
}

function cellCenter(cell: GridCell): [number, number] {
  const ring = cell.geometry.coordinates[0];
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

// Beyond this distance (degrees) from any known grid cell, treat the
// cursor as "outside the data area" rather than showing a misleadingly
// "nearest" reading (e.g. hovering over a city far from Pune).
const MAX_HOVER_DISTANCE_DEG = 0.015;

/**
 * Finds the grid cell nearest the cursor and shows its exact values, plus
 * ward info when the vulnerability overlay is on. Since the discrete grid
 * is no longer drawn, this works from the already-fetched `grid` data in
 * memory rather than querying a rendered layer.
 */
function HoverPopup({ enabled, grid, showVulnerability }: { enabled: boolean; grid: GridResponse | null; showVulnerability: boolean }) {
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
      if (!enabled || !grid) {
        popup.remove();
        return;
      }

      const { lng, lat } = e.lngLat;
      let nearest: GridCell | null = null;
      let nearestDist = Infinity;
      for (const cell of grid.cells) {
        const [clon, clat] = cellCenter(cell);
        const d = Math.hypot(clon - lng, clat - lat);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = cell;
        }
      }

      const wardFeature = showVulnerability
        ? map.queryRenderedFeatures(e.point, { layers: map.getLayer(WARD_FILL_LAYER_ID) ? [WARD_FILL_LAYER_ID] : [] })[0]
        : undefined;

      if ((!nearest || nearestDist > MAX_HOVER_DISTANCE_DEG) && !wardFeature) {
        map.getCanvas().style.cursor = "";
        popup.remove();
        return;
      }

      map.getCanvas().style.cursor = "pointer";

      let html = `<div style="${cardStyle}">`;
      if (nearest && nearestDist <= MAX_HOVER_DISTANCE_DEG) {
        html += `
          <div><strong>Temperature:</strong> ${fmt(nearest.lst_celsius, 1)}\u00b0C</div>
          <div><strong>Vegetation (NDVI):</strong> ${fmt(nearest.ndvi, 2)}</div>
          <div><strong>Built-up density:</strong> ${fmt(nearest.built_up_index, 2)}</div>
          <div><strong>Road density:</strong> ${fmt(nearest.traffic_density, 2)}</div>
        `;
      }
      if (wardFeature) {
        const p = wardFeature.properties as { ward_id: string; hvi: number };
        if (nearest) html += `<div style="margin:6px 0;border-top:1px solid #3f3f46;"></div>`;
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
  }, [map, isLoaded, enabled, grid, showVulnerability]);

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
          <RasterLayer layerId={activeLayer} city="pune" theme={theme} />
          <VulnerabilityLayer visible={showVulnerability} wards={vulnerability} theme={theme} />
          <HoverPopup enabled={showHoverInfo} grid={grid} showVulnerability={showVulnerability} />
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