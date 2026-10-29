/**
 * How the read benchmark calls a result. For each read on one database: the
 * ratio of the candidate mode's p95 to the base mode's (`--modes base,candidate`),
 * each the median of its runs, against the bound (10% by default).
 *
 * The runs' own disagreement decides how close to the bound a ratio may be
 * called: noise is the larger of the two modes' spreads, and a ratio is
 *   - `pass` when it is below the bound by at least half the noise,
 *   - `over` when it is above the bound by at least half the noise,
 *   - `inconclusive` between the two, where more runs are needed to tell.
 * Half, because the medians of several runs vary less than the runs do.
 *
 * Only the Direct API reads gate. The REST reads go through the same reads
 * plus the HTTP layer, and are reported to show that layer leaves the ratio
 * where it is.
 */
import { median, spread } from "./stats.mjs";

/**
 * The verdict for one database's runs: one row per read, comparing `modes`, a
 * base and a candidate, the candidate's p95 over the base's.
 */
export function verdictFor(runs, { bound = 0.1, modes } = {}) {
  if (!Array.isArray(modes) || modes.length !== 2) throw new RangeError("no modes: a verdict compares two, base first");
  if (runs.length === 0) throw new RangeError("no runs");
  const [base, candidate] = modes;
  const reads = Object.keys(runs[0][base].results);
  return {
    reads: reads.map(read => {
      const p95s = mode => runs.map(run => run[mode].results[read].p95);
      const ratio = median(p95s(candidate)) / median(p95s(base));
      const spreads = { [base]: spread(p95s(base)), [candidate]: spread(p95s(candidate)) };
      const margin = Math.max(spreads[base], spreads[candidate]) / 2;
      const limit = 1 + bound;
      const verdict = ratio <= limit - margin ? "pass" : ratio >= limit + margin ? "over" : "inconclusive";
      return { read, ratio, spread: spreads, gates: read.startsWith("direct"), verdict };
    }),
  };
}
