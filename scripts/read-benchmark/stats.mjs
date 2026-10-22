/**
 * The arithmetic the read benchmark reports with: a seeded random source, so a
 * fixture and a read sequence repeat exactly, and the percentiles and spread
 * its verdict is read from.
 */

/**
 * A random source that gives the same sequence for the same seed: Mulberry32,
 * 32-bit state, values in [0, 1). Enough for picking pages, ids and text, and
 * repeatable across machines, which `Math.random` is not.
 */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number in [0, n) from a random source. */
export function pick(random, n) {
  return Math.floor(random() * n);
}

/**
 * The `p`th percentile of `samples` by nearest rank: the smallest sample at or
 * above which `p` percent of the samples lie. It is always one of the samples,
 * so a p95 is a time a read actually took, not an interpolation between two.
 */
export function percentile(samples, p) {
  if (samples.length === 0) throw new RangeError("no samples");
  if (!(p > 0 && p <= 100)) throw new RangeError(`percentile ${p} is outside (0, 100]`);
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil((p / 100) * sorted.length) - 1];
}

/** What one read's timings come to: count, p50, p95, p99 and mean, in ms. */
export function summarize(samples) {
  return {
    n: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    mean: samples.reduce((sum, s) => sum + s, 0) / samples.length,
  };
}

/** The middle value of `values`; the mean of the two middle ones for an even count. */
export function median(values) {
  if (values.length === 0) throw new RangeError("no values");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How far apart repeated measurements of one thing are: (max - min) / median.
 * Runs that agree give a small spread; a comparison smaller than the spread
 * says nothing.
 */
export function spread(values) {
  return (Math.max(...values) - Math.min(...values)) / median(values);
}
