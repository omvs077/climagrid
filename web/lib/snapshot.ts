import type { InterventionSettings } from "./mitigation";

export interface SnapshotScenario {
  slot: string;
  cellCount: number;
  avgDelta: number | null;
  interventions: InterventionSettings;
}

export interface SnapshotData {
  mapCanvas: HTMLCanvasElement;
  cellCount: number;
  avgDelta: number | null;
  baselineLst: number | null;
  estimatedLst: number | null;
  interventions: InterventionSettings;
  scenarios: SnapshotScenario[];
}

interface TextLine {
  text: string;
  size: number;
  color: string;
  bold?: boolean;
}

function fmtDelta(d: number): string {
  return (d > 0 ? "+" : "") + d.toFixed(1) + "\u00b0C";
}

function mixText(i: InterventionSettings): string {
  return "Trees " + i.trees + "% | Roofs " + i.cool_roofs + "% | Built-up " + i.reduce_built_up + "% | Traffic " + i.reduce_traffic + "%";
}

/** Draws the current map view plus a stats card (cooling, slider mix, saved scenarios) into one PNG. */
export function composeSnapshot(data: SnapshotData): Promise<Blob | null> {
  const { mapCanvas } = data;
  const out = document.createElement("canvas");
  out.width = mapCanvas.width;
  out.height = mapCanvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  ctx.drawImage(mapCanvas, 0, 0);

  const s = Math.max(1, out.width / 1100);
  const pad = 14 * s;
  const margin = 16 * s;
  const cardW = Math.min(out.width - 2 * margin, 470 * s);
  const text = "#F2E9D8";
  const muted = "#B9AE96";
  const accent = "#7FD1FF";
  const good = "#9BE37D";

  const date = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const lines: TextLine[] = [];
  lines.push({ text: "CLIMAGRID - PUNE   " + date, size: 13, color: accent, bold: true });

  const anyIntervention =
    data.interventions.trees > 0 ||
    data.interventions.cool_roofs > 0 ||
    data.interventions.reduce_built_up > 0 ||
    data.interventions.reduce_traffic > 0;

  if (data.cellCount > 0 && anyIntervention && data.avgDelta !== null) {
    lines.push({ text: "Estimated cooling: " + fmtDelta(data.avgDelta), size: 18, color: good, bold: true });
    if (data.baselineLst !== null && data.estimatedLst !== null) {
      lines.push({
        text: data.baselineLst.toFixed(1) + "\u00b0C to " + data.estimatedLst.toFixed(1) + "\u00b0C over " + data.cellCount + " cells",
        size: 11,
        color: text,
      });
    }
    lines.push({ text: mixText(data.interventions), size: 11, color: muted });
  } else {
    lines.push({ text: "Baseline heat surface - no scenario applied", size: 12, color: text });
  }

  if (data.scenarios.length > 0) {
    lines.push({ text: "Saved scenarios", size: 11, color: accent, bold: true });
    for (const sc of data.scenarios) {
      const avg = sc.avgDelta !== null ? fmtDelta(sc.avgDelta) + " avg" : "n/a";
      lines.push({ text: sc.slot + ": " + sc.cellCount + " cells, " + avg, size: 11, color: text });
      lines.push({ text: "   " + mixText(sc.interventions), size: 10, color: muted });
    }
  }

  lines.push({
    text: "Illustrative estimate, not a predictive model. Basemap \u00a9 OpenStreetMap contributors.",
    size: 9,
    color: muted,
  });

  let cardH = pad * 2;
  for (const l of lines) cardH += l.size * 1.55 * s;
  const x = margin;
  const y = out.height - margin - cardH;

  ctx.fillStyle = "rgba(27,23,48,0.92)";
  ctx.fillRect(x, y, cardW, cardH);
  ctx.strokeStyle = "#5AA64A";
  ctx.lineWidth = 2 * s;
  ctx.strokeRect(x, y, cardW, cardH);

  ctx.textBaseline = "top";
  let ty = y + pad;
  for (const l of lines) {
    ctx.fillStyle = l.color;
    ctx.font = (l.bold ? "bold " : "") + l.size * s + "px monospace";
    ctx.fillText(l.text, x + pad, ty, cardW - 2 * pad);
    ty += l.size * 1.55 * s;
  }

  return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
}