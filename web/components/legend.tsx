"use client";

import { LAYER_DEFS, getLayerRamp, type LayerId, type MapTheme } from "@/lib/color-scales";

function GradientBar({ colors }: { colors: [string, string, string] }) {
  return (
    <div
      className="h-2 w-full rounded"
      style={{ background: `linear-gradient(to right, ${colors[0]}, ${colors[1]}, ${colors[2]})` }}
    />
  );
}

export function Legend({ layerId, unit, theme }: { layerId: LayerId; unit: string; theme: MapTheme }) {
  const { domain, colors } = getLayerRamp(layerId, theme);
  const label = LAYER_DEFS.find((l) => l.id === layerId)?.label ?? layerId;
  const showUnit = unit === "\u00b0C";
  const fmt = (v: number) => (showUnit ? `${v}${unit}` : v.toString());

  return (
    <div className="w-44 max-w-[calc(100vw-2rem)] rounded-lg border bg-background/90 p-3 shadow-sm backdrop-blur">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <GradientBar colors={colors} />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{fmt(domain[0])}</span>
        <span>{fmt(domain[1])}</span>
        <span>{fmt(domain[2])}</span>
      </div>
    </div>
  );
}

export function HviLegend({ domain, colors }: { domain: [number, number, number]; colors: [string, string, string] }) {
  return (
    <div className="w-44 max-w-[calc(100vw-2rem)] rounded-lg border bg-background/90 p-3 shadow-sm backdrop-blur">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">Ward Vulnerability (HVI)</span>
      <GradientBar colors={colors} />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{domain[0].toFixed(2)}</span>
        <span>{domain[1].toFixed(2)}</span>
        <span>{domain[2].toFixed(2)}</span>
      </div>
    </div>
  );
}