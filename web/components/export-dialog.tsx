"use client";

import { useState } from "react";
import type { GridCell, VulnerabilityWard } from "@/lib/api";
import { LAYER_DEFS, type LayerId } from "@/lib/color-scales";
import { exportGridGeoJSON, exportGridCSV, exportWardsGeoJSON, exportWardsCSV } from "@/lib/export";
import { useToast } from "@/components/toast";

type Dataset = "grid" | "wards" | "both";
type Format = "geojson" | "csv";

export function ExportDialog({
  grid,
  wards,
  onClose,
}: {
  grid: GridCell[] | null;
  wards: VulnerabilityWard[] | null;
  onClose: () => void;
}) {
  const [dataset, setDataset] = useState<Dataset>("grid");
  const [format, setFormat] = useState<Format>("geojson");
  const [includeLocation, setIncludeLocation] = useState(true);
  const [selectedLayers, setSelectedLayers] = useState<Set<LayerId>>(
    new Set(LAYER_DEFS.map((l) => l.id))
  );
  const { showToast } = useToast();

  const toggleLayer = (id: LayerId) => {
    setSelectedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const gridAvailable = !!grid && grid.length > 0;
  const wardsAvailable = !!wards && wards.length > 0;
  const layersChosen = selectedLayers.size > 0;

  const canExport =
    (dataset === "grid" && gridAvailable && (format === "geojson" || layersChosen)) ||
    (dataset === "wards" && wardsAvailable) ||
    (dataset === "both" && gridAvailable && wardsAvailable && (format === "geojson" || layersChosen));

  const handleExport = () => {
    try {
      const layers = Array.from(selectedLayers);
      if (dataset === "grid" || dataset === "both") {
        if (format === "geojson") exportGridGeoJSON(grid!, layers);
        else exportGridCSV(grid!, layers, includeLocation);
      }
      if (dataset === "wards" || dataset === "both") {
        if (format === "geojson") exportWardsGeoJSON(wards!);
        else exportWardsCSV(wards!);
      }
      showToast("Export downloaded.", "success");
      onClose();
    } catch {
      showToast("Something went wrong preparing the export. Please try again.", "error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold">Export data</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mb-4">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">What to export</span>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={dataset === "grid"} onChange={() => setDataset("grid")} disabled={!gridAvailable} />
              Grid cells (temperature, vegetation, density)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={dataset === "wards"} onChange={() => setDataset("wards")} disabled={!wardsAvailable} />
              Ward vulnerability scores (HVI)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={dataset === "both"}
                onChange={() => setDataset("both")}
                disabled={!gridAvailable || !wardsAvailable}
              />
              Both (as separate files)
            </label>
          </div>
        </div>

        <div className="mb-4">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Format</span>
          <div className="flex gap-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={format === "geojson"} onChange={() => setFormat("geojson")} />
              GeoJSON (with map boundaries)
            </label>
            <label className="ml-4 flex items-center gap-2 text-sm">
              <input type="radio" checked={format === "csv"} onChange={() => setFormat("csv")} />
              CSV (spreadsheet-friendly)
            </label>
          </div>
        </div>

        {(dataset === "grid" || dataset === "both") && (
          <div className="mb-4">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Grid layers to include</span>
            <div className="flex flex-col gap-1.5">
              {LAYER_DEFS.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selectedLayers.has(l.id)} onChange={() => toggleLayer(l.id)} />
                  {l.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {(dataset === "grid" || dataset === "both") && format === "csv" && (
          <div className="mb-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeLocation} onChange={(e) => setIncludeLocation(e.target.checked)} />
              Include cell center latitude/longitude
            </label>
          </div>
        )}

        <p className="mb-4 text-xs text-muted-foreground">
          This is a snapshot of the currently loaded data, not a live feed. For the freshest data, reload the page
          before exporting.
        </p>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}