"use client";

import { useEffect, useState, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Map, MapControls, useMap } from "@/components/ui/map";
import { Card } from "@/components/ui/card";
import { fetchGrid, fetchVulnerability, fetchRaster, type GridCell, type GridResponse, type VulnerabilityResponse } from "@/lib/api";
import { getColorForValue, LAYER_DEFS, getWardFillOpacity, type LayerId, type MapTheme } from "@/lib/color-scales";
import { Legend, HviLegend } from "@/components/legend";
import { InfoPanel } from "@/components/info-panel";
import { ExportDialog } from "@/components/export-dialog";
import { useToast } from "@/components/toast";
import { Spinner } from "@/components/spinner";
import { AddressSearch } from "@/components/address-search";
import { MitigationSimulator, type SelectionMode } from "@/components/mitigation-simulator";
import { DEFAULT_INTERVENTIONS, pointInWardGeometry, type InterventionSettings } from "@/lib/mitigation";
import { ScreenZone } from "@/components/ui/screen-zone";
import { type BoundsFilter } from "@/lib/export";

const PUNE_CENTER: [number, number] = [73.845, 18.525];
const PUNE_BBOX = "73.74,18.43,73.95,18.62";

const WARD_SOURCE_ID = "climagrid-wards";
const WARD_FILL_LAYER_ID = "climagrid-wards-fill";
const SIM_SELECTION_SOURCE_ID = "climagrid-sim-selection";
const SIM_SELECTION_LAYER_ID = "climagrid-sim-selection-outline";
const WARD_LINE_LAYER_ID = "climagrid-wards-line";

const HVI_DOMAIN: [number, number, number] = [0.2, 0.4, 0.6];
const HVI_COLORS: [string, string, string] = ["#ffffb2", "#fd8d3c", "#bd0026"];

// Carto's default Positron/Dark Matter styles are intentionally near-monochrome,
// which made roads and buildings almost invisible against the fill layers.
// Voyager keeps the same clean cartography but with real color differentiation.
const MAP_STYLES = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

const INDIA_BOUNDARY_SOURCE_ID = "india-disputed-boundaries";
const INDIA_MUTE_LAYER_ID = "india-boundary-mute";
const INDIA_CLAIMED_LAYER_ID = "india-boundary-claimed";
// Curated by the OpenStreetMap India community specifically to correct
// international basemaps' rendering of India's disputed borders (Jammu &
// Kashmir, Ladakh, Aksai Chin) to match India's official position per
// Survey of India, rather than the internationally-neutral "de facto"
// lines OpenMapTiles-derived styles render by default.
// Source: https://github.com/osm-in/mapbox-gl-styles
const INDIA_BOUNDARY_DATA_URL =
  "https://raw.githubusercontent.com/osm-in/mapbox-gl-styles/master/data/osm-india-adm0-disputed-lines.geojson";

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
 * Finds the basemap's own national/international border layer so our
 * "claimed" correction line can inherit its live paint properties (color,
 * width, opacity) rather than hardcoding a style that could drift out of
 * sync with the base style. Matched by id pattern since this can vary
 * slightly between OpenFreeMap's liberty/dark styles.
 */
function findBorderLayerId(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers;
  if (!layers) return undefined;
  const candidates = layers.filter(
    (l) => l.type === "line" && /boundary|admin|border/i.test(l.id)
  );
  const preferred = candidates.find((l) => /country|adm0|_2\b|level2/i.test(l.id));
  return (preferred ?? candidates[0])?.id;
}

function findBackgroundColor(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers;
  const bgLayer = layers?.find((l) => l.type === "background");
  if (!bgLayer) return undefined;
  return map.getPaintProperty(bgLayer.id, "background-color") as string | undefined;
}

/**
 * Tracks the map's current viewport bounds and lifts them up to the
 * parent, so the export dialog can offer a "current map view" filter
 * instead of always exporting the entire loaded dataset.
 */
function MapBoundsTracker({ onBoundsChange }: { onBoundsChange: (b: BoundsFilter | null) => void }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;

    function updateBounds() {
      const b = map!.getBounds();
      onBoundsChange({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
    }

    updateBounds();
    map.on("moveend", updateBounds);
    return () => {
      map.off("moveend", updateBounds);
    };
  }, [map, isLoaded, onBoundsChange]);

  return null;
}

/**
 * Corrects OpenFreeMap's (and most international basemaps') rendering of
 * India's disputed borders - Jammu & Kashmir, Ladakh, Aksai Chin - to match
 * India's official position per Survey of India, using a curated dataset
 * maintained by the OpenStreetMap India community specifically for this.
 * Non-negotiable per project requirements regardless of current map extent.
 */
function IndiaBoundaryCorrection({ theme }: { theme: MapTheme }) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;
    if (map.getSource(INDIA_BOUNDARY_SOURCE_ID)) return;

    let cancelled = false;

    async function apply() {
      let data: GeoJSON.FeatureCollection;
      try {
        const res = await fetch(INDIA_BOUNDARY_DATA_URL);
        data = await res.json();
        console.log("India boundary feature sample:", data.features[0]?.properties, "total features:", data.features.length);
      } catch (err) {
        console.error("Failed to load India boundary correction data:", err);
        return;
      }
      if (cancelled || !map || map.getSource(INDIA_BOUNDARY_SOURCE_ID)) return;

      map.addSource(INDIA_BOUNDARY_SOURCE_ID, { type: "geojson", data });

const borderLayerId = findBorderLayerId(map);
const styleLayers = map.getStyle()?.layers ?? [];
const borderIdx = borderLayerId
  ? styleLayers.findIndex((l) => l.id === borderLayerId)
  : -1;
const layerAfterBorder =
  borderIdx >= 0 && borderIdx + 1 < styleLayers.length
    ? styleLayers[borderIdx + 1].id
    : undefined;
const beforeId = layerAfterBorder ?? getFirstLabelLayerId(map);
      const baseColor = borderLayerId
        ? (map.getPaintProperty(borderLayerId, "line-color") as string | undefined)
        : undefined;
      const baseWidth = borderLayerId
        ? (map.getPaintProperty(borderLayerId, "line-width") as number | undefined)
        : undefined;
      const baseOpacity = borderLayerId
        ? (map.getPaintProperty(borderLayerId, "line-opacity") as number | undefined)
        : undefined;

      const muteColor = findBackgroundColor(map) ?? (theme === "dark" ? "#1a1a1a" : "#f5f5f0");
      const fallbackBorderColor = theme === "dark" ? "#9a9a9a" : "#7a7a7a";

      map.addLayer(
        {
          id: INDIA_MUTE_LAYER_ID,
          type: "line",
          source: INDIA_BOUNDARY_SOURCE_ID,
          filter: ["==", ["get", "disputed_by"], "IN"],
          paint: {
            "line-color": muteColor,
            "line-width": 5,
          },
        },
        beforeId
      );

      map.addLayer(
        {
          id: INDIA_CLAIMED_LAYER_ID,
          type: "line",
          source: INDIA_BOUNDARY_SOURCE_ID,
          filter: ["==", ["get", "claimed_by"], "IN"],
          paint: {
            "line-color": baseColor ?? fallbackBorderColor,
            "line-width": baseWidth ?? 1.2,
            "line-opacity": baseOpacity ?? 1,
          },
        },
        beforeId
      );
    }

    apply();

    return () => {
      cancelled = true;
    };
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
function RasterLayer({ layerId, city, theme, onLoadingChange }: { layerId: LayerId; city: string; theme: MapTheme; onLoadingChange: (loading: boolean) => void }) {
  const { map, isLoaded } = useMap();
  const { showToast } = useToast();

  useEffect(() => {
    if (!map || !isLoaded) return;

    let cancelled = false;
    onLoadingChange(true);

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
        if (!cancelled) {
          showToast("Couldn't load the heat data for this layer. Please try again.", "error");
        }
      })
      .finally(() => {
        if (!cancelled) onLoadingChange(false);
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

/**
 * Renders selection UI for the mitigation simulator: click-to-toggle
 * individual cells, drag-to-select a rectangular area, or a highlight
 * for whichever cells are currently selected (any mode). Reuses the
 * same nearest-centroid technique as HoverPopup since there is no
 * discrete clickable grid layer - just the smooth raster.
 */
function MitigationSelectionLayer({
  active,
  mode,
  grid,
  selectedCellIds,
  onToggleCell,
  onRectangleSelect,
}: {
  active: boolean;
  mode: "cells" | "rectangle" | "ward";
  grid: GridResponse | null;
  selectedCellIds: Set<string>;
  onToggleCell: (id: string) => void;
  onRectangleSelect: (ids: Set<string>) => void;
}) {
  const { map, isLoaded } = useMap();
  const dragStateRef = useRef<{ startX: number; startY: number; box: HTMLDivElement } | null>(null);

  // Click-to-toggle individual cells
  useEffect(() => {
    if (!map || !isLoaded || !active || mode !== "cells" || !grid) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
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
      if (nearest && nearestDist <= MAX_HOVER_DISTANCE_DEG) {
        onToggleCell(nearest.grid_id);
      }
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [map, isLoaded, active, mode, grid, onToggleCell]);

  // Drag-to-select a rectangular area
  useEffect(() => {
    if (!map || !isLoaded || !active || mode !== "rectangle" || !grid) return;

    const canvas = map.getCanvas();
    const container = map.getContainer();

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;
      const box = document.createElement("div");
      box.style.cssText =
        "position:absolute;border:2px dashed #7EC8E3;background:rgba(126,200,227,0.15);pointer-events:none;z-index:20;";
      box.style.left = startX + "px";
      box.style.top = startY + "px";
      container.appendChild(box);
      dragStateRef.current = { startX, startY, box };
      map.dragPan.disable();
    };

    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const rect = container.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      const left = Math.min(drag.startX, curX);
      const top = Math.min(drag.startY, curY);
      const width = Math.abs(curX - drag.startX);
      const height = Math.abs(curY - drag.startY);
      drag.box.style.left = left + "px";
      drag.box.style.top = top + "px";
      drag.box.style.width = width + "px";
      drag.box.style.height = height + "px";
    };

    const handleMouseUp = (e: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const rect = container.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      const endY = e.clientY - rect.top;

      const p1 = map.unproject([drag.startX, drag.startY]);
      const p2 = map.unproject([endX, endY]);
      const bounds = {
        west: Math.min(p1.lng, p2.lng),
        east: Math.max(p1.lng, p2.lng),
        south: Math.min(p1.lat, p2.lat),
        north: Math.max(p1.lat, p2.lat),
      };

      const matched = new Set<string>();
      for (const cell of grid.cells) {
        const [clon, clat] = cellCenter(cell);
        if (clon >= bounds.west && clon <= bounds.east && clat >= bounds.south && clat <= bounds.north) {
          matched.add(cell.grid_id);
        }
      }
      onRectangleSelect(matched);

      drag.box.remove();
      dragStateRef.current = null;
      map.dragPan.enable();
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      map.dragPan.enable();
    };
  }, [map, isLoaded, active, mode, grid, onRectangleSelect]);

  // Highlight currently-selected cells (any mode) with a pixelated dashed outline
  useEffect(() => {
    if (!map || !isLoaded || !grid) return;

    const featureCollection = {
      type: "FeatureCollection" as const,
      features: grid.cells
        .filter((c) => selectedCellIds.has(c.grid_id))
        .map((c) => ({ type: "Feature" as const, geometry: c.geometry, properties: {} })),
    };

    if (map.getSource(SIM_SELECTION_SOURCE_ID)) {
      (map.getSource(SIM_SELECTION_SOURCE_ID) as maplibregl.GeoJSONSource).setData(
        featureCollection as GeoJSON.FeatureCollection
      );
    } else {
      map.addSource(SIM_SELECTION_SOURCE_ID, { type: "geojson", data: featureCollection as GeoJSON.FeatureCollection });
      map.addLayer({
        id: SIM_SELECTION_LAYER_ID,
        type: "line",
        source: SIM_SELECTION_SOURCE_ID,
        paint: {
          "line-color": "#7EC8E3",
          "line-width": 3,
          "line-dasharray": [2, 1.5],
        },
      });
    }
  }, [map, isLoaded, grid, selectedCellIds]);

  return null;
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
  const [showInfo, setShowInfo] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [mapBounds, setMapBounds] = useState<BoundsFilter | null>(null);
  const [simulatorActive, setSimulatorActive] = useState(false);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("cells");
  const [selectedCellIds, setSelectedCellIds] = useState<Set<string>>(new Set());
  const [selectedWardId, setSelectedWardId] = useState<string | null>(null);
  const [interventions, setInterventions] = useState<InterventionSettings>(DEFAULT_INTERVENTIONS);
  const [rasterLoading, setRasterLoading] = useState(false);
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
          <RasterLayer layerId={activeLayer} city="pune" theme={theme} onLoadingChange={setRasterLoading} />
          <VulnerabilityLayer visible={showVulnerability} wards={vulnerability} theme={theme} />
          <HoverPopup enabled={showHoverInfo} grid={grid} showVulnerability={showVulnerability} />
          <BasemapEnhancer theme={theme} />
          <IndiaBoundaryCorrection theme={theme} />
          <ScreenZone position="top-center">
            <AddressSearch />
          </ScreenZone>
          <MapBoundsTracker onBoundsChange={setMapBounds} />
          <MitigationSelectionLayer
            active={simulatorActive}
            mode={selectionMode}
            grid={grid}
            selectedCellIds={selectedCellIds}
            onToggleCell={(id) => {
              setSelectedCellIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
            onRectangleSelect={(ids) => setSelectedCellIds(ids)}
          />
        </Map>
      </Card>

      <ScreenZone position="top-left">
        <div className="flex flex-col gap-1 rounded-lg border bg-background/90 p-3 shadow-sm backdrop-blur">
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

        <div className="mt-2 border-t pt-2">
          <button
            onClick={() => setSimulatorActive((a) => !a)}
            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          >
            {simulatorActive ? "Close Mitigation Simulator" : "Open Mitigation Simulator"}
          </button>
        </div>

        <div className="mt-2 border-t pt-2">
          <button
            onClick={() => setShowInfo(true)}
            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          >
            &#9432; About this data
          </button>
        </div>

        <div className="mt-2 border-t pt-2">
          <button
            onClick={() => setShowExport(true)}
            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          >
            &#8681; Export data
          </button>
        </div>
        </div>
      </ScreenZone>

      {showInfo && <InfoPanel city="pune" onClose={() => setShowInfo(false)} />}
      {showExport && (
        <ExportDialog grid={grid?.cells ?? null} wards={vulnerability?.wards ?? null} mapBounds={mapBounds} onClose={() => setShowExport(false)} />
      )}

      <MitigationSimulator
        active={simulatorActive}
        onClose={() => setSimulatorActive(false)}
        selectionMode={selectionMode}
        onSelectionModeChange={setSelectionMode}
        selectedCellIds={selectedCellIds}
        onClearSelection={() => {
          setSelectedCellIds(new Set());
          setSelectedWardId(null);
        }}
        grid={grid}
        wards={vulnerability?.wards ?? null}
        selectedWardId={selectedWardId}
        onSelectWard={(wardId) => {
          setSelectedWardId(wardId);
          if (!wardId || !grid || !vulnerability) {
            setSelectedCellIds(new Set());
            return;
          }
          const ward = vulnerability.wards.find((w) => w.ward_id === wardId);
          if (!ward) {
            setSelectedCellIds(new Set());
            return;
          }
          const matched = new Set<string>();
          for (const cell of grid.cells) {
            const [lon, lat] = cellCenter(cell);
            if (pointInWardGeometry(lon, lat, ward.geometry)) {
              matched.add(cell.grid_id);
            }
          }
          setSelectedCellIds(matched);
        }}
        interventions={interventions}
        onInterventionsChange={setInterventions}
      />

      <ScreenZone position="top-right">
        {rasterLoading && (
          <div className="flex items-center gap-2 rounded-lg border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
            <Spinner className="h-3.5 w-3.5" />
            Updating heat map&hellip;
          </div>
        )}
        <Legend
          layerId={activeLayer}
          unit={LAYER_DEFS.find((l) => l.id === activeLayer)?.unit ?? ""}
          theme={theme}
        />
        {showVulnerability && <HviLegend domain={HVI_DOMAIN} colors={HVI_COLORS} />}
      </ScreenZone>

      {loading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/70 backdrop-blur-sm">
          <Spinner className="h-8 w-8 text-primary" />
          <span className="text-sm text-muted-foreground">Loading Pune climate data&hellip;</span>
        </div>
      )}
      {error && (
        <div className="absolute bottom-4 left-4 z-20 flex items-center gap-3 rounded-lg border bg-destructive px-4 py-3 text-sm text-destructive-foreground shadow-lg">
          <span>Couldn&apos;t load climate data. Check your connection and reload the page.</span>
        </div>
      )}
    </div>
  );
}