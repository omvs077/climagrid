import type { InterventionType, InterventionSettings } from "./mitigation";
import { dominantIntervention } from "./mitigation";

export interface Benchmark {
  text: string;
  source: string;
  url: string;
}

/**
 * Real-world reference points for each intervention type, paraphrased from
 * published studies. These are illustrative context for the simulator's
 * own (non-scientific) estimate, not a claim that the estimate matches
 * these figures exactly - study conditions, cities, and methods differ.
 */
export const BENCHMARKS: Record<InterventionType, Benchmark> = {
  trees: {
    text: "in the range of what a 10% citywide rise in tree canopy achieved on average across hundreds of cities (~0.3\u00b0C)",
    source: "World Resources Institute, 2026",
    url: "https://www.wri.org/insights/urban-trees-cooling-potential",
  },
  cool_roofs: {
    text: "comparable to switching every roof in a metro area to reflective \"cool roof\" material during a heatwave (~2\u00b0C in Chicago's most built-up areas)",
    source: "Argonne National Laboratory / AGU, 2022",
    url: "https://news.agu.org/press-release/roof-materials-on-chicago-buildings-can-substantially-lower-temperatures-during-heat-waves/",
  },
  reduce_built_up: {
    text: "similar to converting a paved parking lot into a vegetated park (~1.2\u00b0C peak reduction measured in Antwerp)",
    source: "ScienceDirect, 2026",
    url: "https://www.sciencedirect.com/science/article/abs/pii/S1618866726002128",
  },
  reduce_traffic: {
    text: "close to the warming that ordinary road traffic itself adds to a mid-size city (~0.25-0.4\u00b0C, modeled in Toulouse and Manchester)",
    source: "phys.org summary, 2026",
    url: "https://phys.org/news/2026-05-traffic-cities-warmer.html",
  },
};

/** Picks the benchmark for whichever intervention is driving the current estimate, if any. */
export function pickBenchmark(settings: InterventionSettings): Benchmark | null {
  const dominant = dominantIntervention(settings);
  return dominant ? BENCHMARKS[dominant] : null;
}