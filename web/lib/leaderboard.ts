import type { InterventionSettings } from "./mitigation";
import { estimateCellDelta } from "./mitigation";

export interface WardBucket {
  ward_id: string;
  hviScore: number;
  cellCount: number;
}

export interface WardRanking extends WardBucket {
  score: number;
}

/**
 * Ranks wards by cooling benefit per unit effort, weighted by vulnerability.
 * The simulator applies the same flat cooling to every cell regardless of
 * location, so raw cooling can never differ between wards under one slider
 * mix - the only real differences are ward size (effort to cover) and
 * vulnerability (who benefits). score = |delta| * hviScore / cellCount,
 * so a smaller, higher-HVI ward ranks above a larger, lower-HVI one for the
 * same intervention mix. Illustrative prioritization aid, not a predictive
 * model - see lib/mitigation.ts for the same caveat on the cooling estimate.
 */
export function rankWards(buckets: WardBucket[], settings: InterventionSettings): WardRanking[] {
  const delta = estimateCellDelta(settings);
  return buckets
    .filter((b) => b.cellCount > 0)
    .map((b) => ({ ...b, score: delta > 0 ? (delta * b.hviScore) / b.cellCount : 0 }))
    .sort((a, b) => b.score - a.score);
}