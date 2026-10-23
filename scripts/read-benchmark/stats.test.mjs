import { describe, expect, it } from "vitest";

import { median, percentile, pick, seededRandom, spread, summarize } from "./stats.mjs";

describe("the seeded random source", () => {
  it("repeats a sequence for one seed and differs for another", () => {
    const take = seed => Array.from({ length: 5 }, seededRandom(seed));
    expect(take(42)).toEqual(take(42));
    expect(take(42)).not.toEqual(take(43));
  });

  it("gives Mulberry32's own sequence, so a fixture repeats across machines", () => {
    // Mulberry32 with seed 1: its published first outputs (0.6270739405881613, ...).
    const random = seededRandom(1);
    expect([random(), random(), random()].map(v => v.toFixed(8))).toEqual(["0.62707394", "0.00273572", "0.52744704"]);
  });

  it("stays in [0, 1) and picks every whole number below n", () => {
    const random = seededRandom(7);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const v = random();
      expect(v >= 0 && v < 1).toBe(true);
      seen.add(pick(random, 10));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("percentiles by nearest rank", () => {
  const hundred = Array.from({ length: 100 }, (_, i) => 100 - i); // 100..1, unsorted

  it("is a sample at or above which p percent lie", () => {
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 100)).toBe(100);
    expect(percentile([3, 1, 2], 95)).toBe(3);
  });

  it("is always one of the samples, never an interpolation", () => {
    // Nearest rank of 10 samples at p95 is the 10th; an interpolating
    // percentile would give a value between 9 and 10.
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });

  it("refuses no samples and a percentile outside (0, 100]", () => {
    expect(() => percentile([], 95)).toThrow(RangeError);
    expect(() => percentile([1], 0)).toThrow(RangeError);
    expect(() => percentile([1], 101)).toThrow(RangeError);
  });

  it("leaves the samples as they were given", () => {
    const samples = [3, 1, 2];
    percentile(samples, 50);
    expect(samples).toEqual([3, 1, 2]);
  });
});

describe("a summary, a median and a spread", () => {
  it("summarizes count, p50, p95, p99 and mean", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(summarize(samples)).toEqual({ n: 100, p50: 50, p95: 95, p99: 99, mean: 50.5 });
  });

  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("measures spread against the median", () => {
    expect(spread([10, 10.2, 10.5])).toBeCloseTo(0.5 / 10.2, 10);
    expect(spread([7, 7, 7])).toBe(0);
  });
});
