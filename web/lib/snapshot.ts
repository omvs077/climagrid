import type { InterventionSettings } from "./mitigation";

export interface SnapshotScenario {
  slot: string;
  cellCount: number;
  avgDelta: number | null;
  interventions: InterventionSettings;
}

export interface SnapshotDecoration {
  kind: "tree_teal" | "tree_orange" | "roof" | "greenspace" | "calm";
  x: number;
  y: number;
}

export interface SnapshotData {
  decorations: SnapshotDecoration[];
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
const spriteCache: Record<string, HTMLImageElement> = {};
function loadSprite(src: string): Promise<HTMLImageElement> {
  const cached = spriteCache[src];
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      spriteCache[src] = img;
      resolve(img);
    };
    img.onerror = reject;
    img.src = src;
  });
}

async function drawDecorations(ctx: CanvasRenderingContext2D, decorations: SnapshotDecoration[], scale: number) {
  const needsTeal = decorations.some((d) => d.kind === "tree_teal");
  const needsOrange = decorations.some((d) => d.kind === "tree_orange");
  const treeTeal = needsTeal ? await loadSprite("/sprites/_curated/tree_teal.png") : null;
  const treeOrange = needsOrange ? await loadSprite("/sprites/_curated/tree_orange.png") : null;
  const treeSize = 16 * scale;
  for (const d of decorations) {
    const x = d.x * scale;
    const y = d.y * scale;
    if (d.kind === "tree_teal" && treeTeal) {
      ctx.drawImage(treeTeal, x - treeSize / 2, y - treeSize / 2, treeSize, treeSize);
    } else if (d.kind === "tree_orange" && treeOrange) {
      ctx.drawImage(treeOrange, x - treeSize / 2, y - treeSize / 2, treeSize, treeSize);
    } else if (d.kind === "roof") {
      const s2 = 10 * scale;
      ctx.fillStyle = "#7EC8E3";
      ctx.strokeStyle = "#1B1730";
      ctx.lineWidth = Math.max(1, scale);
      ctx.fillRect(x - s2 / 2, y - s2 / 2, s2, s2);
      ctx.strokeRect(x - s2 / 2, y - s2 / 2, s2, s2);
    } else if (d.kind === "greenspace") {
      const r = 5 * scale;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#4C9A4A";
      ctx.fill();
      ctx.strokeStyle = "#1B1730";
      ctx.lineWidth = Math.max(1, scale);
      ctx.stroke();
    } else if (d.kind === "calm") {
      const s2 = 8 * scale;
      ctx.fillStyle = "rgba(242,233,216,0.85)";
      ctx.fillRect(x - s2 / 2, y - s2 / 2, s2, s2);
      ctx.setLineDash([2 * scale, 1.5 * scale]);
      ctx.strokeStyle = "#6b5a3f";
      ctx.lineWidth = Math.max(1, scale);
      ctx.strokeRect(x - s2 / 2, y - s2 / 2, s2, s2);
      ctx.setLineDash([]);
    }
  }
}

export async function composeSnapshot(data: SnapshotData): Promise<Blob | null> {
  const { mapCanvas } = data;
  const out = document.createElement("canvas");
  out.width = mapCanvas.width;
  out.height = mapCanvas.height;
  const ctx = out.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  ctx.drawImage(mapCanvas, 0, 0);

  const scale = mapCanvas.width / (mapCanvas.clientWidth || mapCanvas.width);
  if (data.decorations.length > 0) {
    await drawDecorations(ctx, data.decorations, scale);
  }

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
    text: "Illustrative estimate, not a predictive model.",
    size: 9,
    color: muted,
  });
  lines.push({
    text: "Basemap: OpenFreeMap \u00a9 OpenMapTiles, data from OpenStreetMap.",
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
