"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import type { GridResponse, VulnerabilityWard } from "@/lib/api";
import {
  type InterventionSettings,
  type InterventionType,
  estimateCells,
  summarizeEstimates,
} from "@/lib/mitigation";
import { Building } from "@nsmr/pixelart-react";

export type SelectionMode = "cells" | "rectangle" | "ward";

const INTERVENTION_LABELS: Record<InterventionType, string> = {
  trees: "Add Trees",
  cool_roofs: "Cool Roofs",
  reduce_built_up: "Reduce Built-up",
  reduce_traffic: "Reduce Traffic",
};

export function MitigationSimulator({
  active,
  onClose,
  selectionMode,
  onSelectionModeChange,
  selectedCellIds,
  onClearSelection,
  grid,
  wards,
  selectedWardId,
  onSelectWard,
  interventions,
  onInterventionsChange,
}: {
  active: boolean;
  onClose: () => void;
  selectionMode: SelectionMode;
  onSelectionModeChange: (mode: SelectionMode) => void;
  selectedCellIds: Set<string>;
  onClearSelection: () => void;
  grid: GridResponse | null;
  wards: VulnerabilityWard[] | null;
  selectedWardId: string | null;
  onSelectWard: (wardId: string | null) => void;
  interventions: InterventionSettings;
  onInterventionsChange: (settings: InterventionSettings) => void;
}) {
  const selectedCells = useMemo(() => {
    if (!grid) return [];
    return grid.cells.filter((c) => selectedCellIds.has(c.grid_id));
  }, [grid, selectedCellIds]);

  const summary = useMemo(() => {
    const estimates = estimateCells(selectedCells, interventions);
    return summarizeEstimates(estimates);
  }, [selectedCells, interventions]);

  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const panel = e.currentTarget.closest("[data-sim-panel]") as HTMLElement | null;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    function handleMove(ev: MouseEvent) {
      if (!dragOffset.current) return;
      setDragPos({ x: ev.clientX - dragOffset.current.x, y: ev.clientY - dragOffset.current.y });
    }
    function handleUp() {
      dragOffset.current = null;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, []);

  if (!active) return null;

  const hasAnyIntervention =
    interventions.trees > 0 ||
    interventions.cool_roofs > 0 ||
    interventions.reduce_built_up > 0 ||
    interventions.reduce_traffic > 0;

  const mascotSrc = hasAnyIntervention
    ? "/sprites/_curated/character_1.png"
    : "/sprites/_curated/character_2.png";
  const mascotAlt = hasAnyIntervention ? "Happy city mascot" : "Waiting city mascot";

  function updateIntervention(key: InterventionType, value: number) {
    onInterventionsChange({ ...interventions, [key]: value });
  }

  const pixelFont = { fontFamily: "var(--font-pixel)" };


  return (
    <div
      data-sim-panel
      className="fixed z-20 w-80 overflow-y-auto border-4 border-[#0f0d1a] p-4 shadow-2xl"
      style={{
        maxHeight: "calc(100vh - 6rem)",
        background: "#1B1730",
        boxShadow: "6px 6px 0 rgba(0,0,0,0.4), inset 0 0 0 2px #4C9A4A",
        left: dragPos ? dragPos.x + "px" : undefined,
        top: dragPos ? dragPos.y + "px" : "320px",
        right: dragPos ? undefined : "16px",
      }}
    >
      <div
        className="mb-3 flex cursor-move items-start justify-between select-none"
        onMouseDown={handleDragStart}
      >
        <h2 className="text-xs leading-relaxed text-[#F2E9D8]" style={pixelFont}>
          RESTORE THE CITY
        </h2>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-[#F2E9D8] hover:text-[#E85D4C]"
          style={pixelFont}
          aria-label="Close"
        >
          X
        </button>
      </div>

      <div className="mb-4 flex items-center gap-3 border-2 border-[#4C9A4A] bg-[#241f3d] p-2">
        <img
          src={mascotSrc}
          alt={mascotAlt}
          width={48}
          height={48}
          style={{ imageRendering: "pixelated" }}
        />
        <p className="text-[10px] leading-relaxed text-[#F2E9D8]" style={pixelFont}>
          {hasAnyIntervention
            ? "Nice work! The city is cooling down."
            : "Adjust the sliders below to explore changes."}
        </p>
      </div>

      <div className="mb-4">
        <span className="mb-1.5 block text-[10px] text-[#7EC8E3]" style={pixelFont}>
          Selection Mode
        </span>
        <div className="grid grid-cols-3 gap-1">
          {(["cells", "rectangle", "ward"] as SelectionMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onSelectionModeChange(mode)}
              className={
                "border-2 px-2 py-1.5 text-[9px] leading-tight " +
                (selectionMode === mode
                  ? "border-[#7EC8E3] bg-[#2f2a4d] text-[#F2E9D8]"
                  : "border-[#3a3560] bg-[#1B1730] text-[#8a86a8] hover:border-[#7EC8E3]/60")
              }
              style={pixelFont}
            >
              {mode === "cells" ? "Click Cells" : mode === "rectangle" ? "Draw Area" : "Pick Ward"}
            </button>
          ))}
        </div>
      </div>

      {selectionMode === "ward" && wards && (
        <div className="mb-4">
          <select
            value={selectedWardId ?? ""}
            onChange={(e) => onSelectWard(e.target.value || null)}
            className="w-full border-2 border-[#3a3560] bg-[#1B1730] px-2 py-1.5 text-xs text-[#F2E9D8]"
          >
            <option value="">Select a ward...</option>
            {wards.map((w) => (
              <option key={w.ward_id} value={w.ward_id}>
                {w.ward_id}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] text-[#8a86a8]">
          {selectedCellIds.size} cell{selectedCellIds.size === 1 ? "" : "s"} selected
        </span>
        {selectedCellIds.size > 0 && (
          <button onClick={onClearSelection} className="text-[10px] text-[#E85D4C] underline">
            Clear
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <InterventionSlider
          icon={
            <img
              src="/sprites/_curated/tree_teal.png"
              alt=""
              width={20}
              height={20}
              style={{ imageRendering: "pixelated" }}
            />
          }
          label={INTERVENTION_LABELS.trees}
          value={interventions.trees}
          onChange={(v) => updateIntervention("trees", v)}
        />
        <InterventionSlider
          icon={<Building size={20} color="#7EC8E3" />}
          label={INTERVENTION_LABELS.cool_roofs}
          value={interventions.cool_roofs}
          onChange={(v) => updateIntervention("cool_roofs", v)}
        />
        <InterventionSlider
          icon={<Building size={20} color="#C97B4A" />}
          label={INTERVENTION_LABELS.reduce_built_up}
          value={interventions.reduce_built_up}
          onChange={(v) => updateIntervention("reduce_built_up", v)}
        />
        <InterventionSlider
          icon={
            <img
              src="/sprites/_curated/car_taxi.png"
              alt=""
              width={20}
              height={20}
              style={{ imageRendering: "pixelated" }}
            />
          }
          label={INTERVENTION_LABELS.reduce_traffic}
          value={interventions.reduce_traffic}
          onChange={(v) => updateIntervention("reduce_traffic", v)}
        />
      </div>

      <div className="border-2 border-[#C97B4A] bg-[#F2E9D8] p-3">
        <div className="text-[10px] uppercase tracking-wide text-[#6b5a3f]">Estimated cooling</div>
        <div className="text-xl font-semibold text-[#1B1730]">
          {summary.cellCount === 0
            ? "-"
            : (summary.avgDelta > 0 ? "+" : "") + summary.avgDelta.toFixed(1) + "\u00b0C"}
        </div>
        <div className="mt-1 text-[10px] text-[#6b5a3f]">
          {summary.avgBaselineLst !== null
            ? summary.avgBaselineLst.toFixed(1) + "\u00b0C to " + (summary.avgEstimatedLst as number).toFixed(1) + "\u00b0C"
            : "Select cells to see an estimate"}
        </div>
      </div>
    </div>
  );
}

function InterventionSlider({
  icon,
  label,
  value,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        {icon}
        <span className="text-[10px] text-[#F2E9D8]" style={{ fontFamily: "var(--font-pixel)" }}>
          {label}
        </span>
        <span className="ml-auto text-[10px] text-[#7EC8E3]">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#4C9A4A]"
      />
    </div>
  );
}