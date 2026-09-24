"use client";

import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import type { GridResponse, VulnerabilityWard } from "@/lib/api";
import {
  type InterventionSettings,
  type InterventionType,
  estimateCells,
  summarizeEstimates,
} from "@/lib/mitigation";
import { Building } from "@nsmr/pixelart-react";
import { playBlip, playChime } from "@/lib/sound";

export type SelectionMode = "cells" | "rectangle" | "ward";

const INTERVENTION_LABELS: Record<InterventionType, string> = {
  trees: "Add Trees",
  cool_roofs: "Cool Roofs",
  reduce_built_up: "Reduce Built-up",
  reduce_traffic: "Reduce Traffic",
};

type ScenarioSlot = "A" | "B" | "C";
const SCENARIO_SLOTS: ScenarioSlot[] = ["A", "B", "C"];
interface Scenario {
  cellIds: string[];
  interventions: InterventionSettings;
  cellCount: number;
  avgDelta: number | null;
}

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
  onRestoreSelection,
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
  onRestoreSelection: (ids: Set<string>) => void;
}) {
  const selectedCells = useMemo(() => {
    if (!grid) return [];
    return grid.cells.filter((c) => selectedCellIds.has(c.grid_id));
  }, [grid, selectedCellIds]);

  const summary = useMemo(() => {
    const estimates = estimateCells(selectedCells, interventions);
    return summarizeEstimates(estimates);
  }, [selectedCells, interventions]);

  // Saved what-if scenarios (session-only; a refresh clears them).
  const [scenarios, setScenarios] = useState<Record<ScenarioSlot, Scenario | null>>({ A: null, B: null, C: null });
  const canSave =
    selectedCellIds.size > 0 &&
    (interventions.trees > 0 ||
      interventions.cool_roofs > 0 ||
      interventions.reduce_built_up > 0 ||
      interventions.reduce_traffic > 0);
  const savedDeltas = SCENARIO_SLOTS.map((s) => scenarios[s]?.avgDelta).filter((d): d is number => d != null);
  const bestDelta = savedDeltas.length >= 2 ? Math.min(...savedDeltas) : null;

  function saveScenario(slot: ScenarioSlot) {
    if (!canSave) return;
    setScenarios((prev) => ({
      ...prev,
      [slot]: {
        cellIds: Array.from(selectedCellIds),
        interventions: { ...interventions },
        cellCount: selectedCellIds.size,
        avgDelta: summary.avgBaselineLst !== null ? summary.avgDelta : null,
      },
    }));
  }
  function loadScenario(slot: ScenarioSlot) {
    const s = scenarios[slot];
    if (!s) return;
    onRestoreSelection(new Set(s.cellIds));
    onInterventionsChange({ ...s.interventions });
  }
  function clearScenario(slot: ScenarioSlot) {
    setScenarios((prev) => ({ ...prev, [slot]: null }));
  }

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

  // Chime once when a real change becomes effective (selection + a
  // non-zero intervention), not on every slider tick.
  const prevEffectiveRef = useRef(false);
  useEffect(() => {
    const currentlyEffective =
      selectedCellIds.size > 0 &&
      (interventions.trees > 0 ||
        interventions.cool_roofs > 0 ||
        interventions.reduce_built_up > 0 ||
        interventions.reduce_traffic > 0);
    if (currentlyEffective && !prevEffectiveRef.current) {
      playChime();
    }
    prevEffectiveRef.current = currentlyEffective;
  }, [selectedCellIds, interventions.trees, interventions.cool_roofs, interventions.reduce_built_up, interventions.reduce_traffic]);

  if (!active) return null;

  const hasSelection = selectedCellIds.size > 0;
  const hasAnyIntervention =
    interventions.trees > 0 ||
    interventions.cool_roofs > 0 ||
    interventions.reduce_built_up > 0 ||
    interventions.reduce_traffic > 0;
  const isEffective = hasSelection && hasAnyIntervention;

  const mascotSrc = isEffective
    ? "/sprites/_curated/character_1.png"
    : "/sprites/_curated/character_2.png";
  const mascotAlt = isEffective ? "Happy city mascot" : "Waiting city mascot";

  let mascotMessage: string;
  if (!hasSelection) {
    mascotMessage = hasAnyIntervention
      ? "Nothing selected yet - use Click Cells, Draw Area, or Pick Ward to apply these changes."
      : "Click Cells, Draw Area, or Pick Ward to choose where to explore changes.";
  } else if (!hasAnyIntervention) {
    mascotMessage = selectedCellIds.size + " cell" + (selectedCellIds.size === 1 ? "" : "s") + " ready - adjust the sliders below.";
  } else {
    const magnitude = Math.abs(summary.avgDelta);
    if (magnitude < 1) {
      mascotMessage = "A good start! Every bit of shade helps.";
    } else if (magnitude < 2.5) {
      mascotMessage = "Nice work! The city is cooling down.";
    } else {
      mascotMessage = "Amazing! You've transformed this neighborhood.";
    }
  }

  function updateIntervention(key: InterventionType, value: number) {
    onInterventionsChange({ ...interventions, [key]: value });
  }

  const pixelFont = { fontFamily: "var(--font-pixel)" };

  return (
    <div
      data-sim-panel
      className="fixed z-20 w-80 overflow-y-auto border-4 border-black bg-card p-4 text-card-foreground shadow-2xl"
      style={{
        maxHeight: "calc(100vh - 6rem)",
        boxShadow: "6px 6px 0 rgba(0,0,0,0.4), inset 0 0 0 2px var(--primary)",
        left: dragPos ? dragPos.x + "px" : undefined,
        top: dragPos ? dragPos.y + "px" : "320px",
        right: dragPos ? undefined : "16px",
      }}
    >
      <div
        className="mb-3 flex cursor-move items-start justify-between select-none"
        onMouseDown={handleDragStart}
      >
        <h2 className="text-xs leading-relaxed" style={pixelFont}>
          RESTORE THE CITY
        </h2>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-card-foreground hover:text-destructive"
          style={pixelFont}
          aria-label="Close"
        >
          X
        </button>
      </div>

      <div className="mb-4 flex items-center gap-3 border-2 border-primary bg-muted p-2">
        <img
          src={mascotSrc}
          alt={mascotAlt}
          width={48}
          height={48}
          style={{ imageRendering: "pixelated" }}
        />
        <p className="text-[10px] leading-relaxed" style={pixelFont}>
          {mascotMessage}
        </p>
      </div>

      <div className="mb-4">
        <span className="mb-1.5 block text-[10px] text-accent" style={pixelFont}>
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
                  ? "border-accent bg-muted text-card-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-accent/60")
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
            className="w-full border-2 border-border bg-card px-2 py-1.5 text-xs text-card-foreground"
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
        <span className="text-[10px] text-muted-foreground">
          {selectedCellIds.size} cell{selectedCellIds.size === 1 ? "" : "s"} selected
        </span>
        {selectedCellIds.size > 0 && (
          <button onClick={onClearSelection} className="text-[10px] text-destructive underline">
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
          icon={<Building size={20} color="var(--accent)" />}
          label={INTERVENTION_LABELS.cool_roofs}
          value={interventions.cool_roofs}
          onChange={(v) => updateIntervention("cool_roofs", v)}
        />
        <InterventionSlider
          icon={<Building size={20} color="var(--secondary)" />}
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

      <div className="border-2 border-secondary bg-[#F2E9D8] p-3">
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

      <div className="mt-4 border-2 border-border p-3">
        <span className="mb-2 block text-[10px] text-accent" style={pixelFont}>
          Scenarios
        </span>
        <div className="flex flex-col gap-2">
          {SCENARIO_SLOTS.map((slot) => {
            const s = scenarios[slot];
            return (
              <div key={slot} className="border border-border bg-muted p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px]" style={pixelFont}>
                    {slot}
                    {s && bestDelta !== null && s.avgDelta === bestDelta ? " - BEST" : ""}
                  </span>
                  <div className="flex gap-2 text-[10px]">
                    {s && (
                      <button onClick={() => loadScenario(slot)} className="text-accent underline">
                        Load
                      </button>
                    )}
                    <button
                      onClick={() => saveScenario(slot)}
                      disabled={!canSave}
                      className={"underline " + (canSave ? "text-card-foreground" : "text-muted-foreground opacity-50")}
                    >
                      Save here
                    </button>
                    {s && (
                      <button onClick={() => clearScenario(slot)} className="text-destructive underline">
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                {s ? (
                  <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    <div>
                      {s.cellCount + " cells, " + (s.avgDelta !== null ? s.avgDelta.toFixed(1) + "\u00b0C avg" : "n/a")}
                    </div>
                    <div>
                      {"Trees " + s.interventions.trees + "% | Roofs " + s.interventions.cool_roofs + "% | Built-up " + s.interventions.reduce_built_up + "% | Traffic " + s.interventions.reduce_traffic + "%"}
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 text-[10px] text-muted-foreground">Empty</div>
                )}
              </div>
            );
          })}
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
        <span className="text-[10px]" style={{ fontFamily: "var(--font-pixel)" }}>
          {label}
        </span>
        <span className="ml-auto text-[10px] text-accent">{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={10}
        value={value}
        onChange={(e) => {
          onChange(Number(e.target.value));
          playBlip();
        }}
        className="w-full accent-[var(--primary)]"
      />
    </div>
  );
}
