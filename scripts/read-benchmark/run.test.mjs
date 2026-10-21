import { describe, expect, it } from "vitest";

import { keyFor } from "./saved.mjs";
import {
  checkLimits,
  checkNumbers,
  needsAnotherRun,
  optionsOf,
  orderFor,
  overallCall,
  reportSettings,
  revisionOf,
  runsAgree,
  savedRun,
  tableLines,
  withinLoad,
} from "./run.mjs";

/** A run whose every read took `main` and `perLanguage` at p95 (and half that at p50). */
const run = (main, perLanguage) => ({
  main: { results: { "direct list": { p50: main / 2, p95: main } } },
  "per-language": { results: { "direct list": { p50: perLanguage / 2, p95: perLanguage } } },
});

describe("how the benchmark runs", () => {
  it("alternates the order of the modes from run to run", () => {
    expect(orderFor(0)).toEqual(["main", "per-language"]);
    expect(orderFor(1)).toEqual(["per-language", "main"]);
    expect(orderFor(2)).toEqual(["main", "per-language"]);
  });

  it("sees runs agree only when every mode's p95s spread within the limit", () => {
    expect(runsAgree([run(10, 11), run(10.2, 11.1), run(10.1, 11)], 0.05)).toBe(true);
    expect(runsAgree([run(10, 11), run(11, 11.1), run(10.1, 11)], 0.05)).toBe(false);
    expect(runsAgree([run(10, 11), run(10, 12), run(10, 11)], 0.05)).toBe(false);
  });

  it("adds runs until the minimum, then while they disagree and there is room", () => {
    const limits = { minRuns: 2, maxRuns: 6, spreadLimit: 0.05 };
    const agreeing = [run(10, 11), run(10, 11), run(10, 11), run(10, 11)];
    const disagreeing = [run(10, 11), run(12, 11), run(10, 11), run(12, 11)];
    expect(needsAnotherRun(agreeing.slice(0, 1), limits)).toBe(true);
    expect(needsAnotherRun(agreeing.slice(0, 2), limits)).toBe(false);
    expect(needsAnotherRun(disagreeing, limits)).toBe(true);
    expect(needsAnotherRun([...disagreeing, run(12, 11), run(10, 11)], limits)).toBe(false);
  });

  it("stops only after as many runs measured each mode first as second", () => {
    // Three agreeing runs measured `main` first twice and `per-language` once:
    // a drift within a run would fall on one mode more than the other.
    const limits = { minRuns: 3, maxRuns: 6, spreadLimit: 0.05 };
    const agreeing = Array.from({ length: 4 }, () => run(10, 11));
    expect(needsAnotherRun(agreeing.slice(0, 3), limits)).toBe(true);
    expect(needsAnotherRun(agreeing, limits)).toBe(false);
  });

  it("refuses a run limit that would end on an unbalanced run", () => {
    expect(() => checkLimits({ minRuns: 3, maxRuns: 6 })).not.toThrow();
    expect(() => checkLimits({ minRuns: 3, maxRuns: 5 })).toThrow(/--max-runs/);
    expect(() => checkLimits({ minRuns: 8, maxRuns: 6 })).toThrow(/--runs/);
  });
});

describe("what a run accepts", () => {
  it("accepts a measurement only when its load started and ended within the limit", () => {
    expect(withinLoad({ loadStart: 7, loadEnd: 8 }, 8)).toBe(true);
    // Load that rose after the wait, while the heavy-job bound queued it, say.
    expect(withinLoad({ loadStart: 12, loadEnd: 6 }, 8)).toBe(false);
    expect(withinLoad({ loadStart: 6, loadEnd: 8.6 }, 8)).toBe(false);
  });

  it("reuses a saved run only when both its modes were saved", () => {
    const saved = new Map([
      [keyFor("sqlite", 0, "main"), { p: 1 }],
      [keyFor("sqlite", 0, "per-language"), { p: 2 }],
      [keyFor("sqlite", 1, "per-language"), { p: 3 }],
    ]);
    expect(savedRun(saved, "sqlite", 0)).toEqual({ main: { p: 1 }, "per-language": { p: 2 } });
    // Half a run, its other half lost with the process: both are taken again together.
    expect(savedRun(saved, "sqlite", 1)).toBeNull();
    expect(savedRun(saved, "mysql", 0)).toBeNull();
  });

  it("takes the documented defaults and refuses numbers that would disable a control", () => {
    expect(() => checkNumbers(optionsOf([]))).not.toThrow();
    // Each refused by this check's own message: `--warmup=-1`, since a bare
    // `-1` is read as a flag and refused before it reaches the check.
    for (const bad of [["--warmup=-1"], ["--max-load", "Infinity"], ["--bound", "Infinity"], ["--docs", "10"], ["--iterations", "1.5"], ["--spread-limit", "0"], ["--seed", "x"]]) {
      const name = bad[0].split("=")[0];
      expect(() => checkNumbers(optionsOf(bad)), bad.join(" ")).toThrow(new RegExp(`^${name} .* is not `));
    }
  });

  it("names the commit it measures, and what differs from it", () => {
    expect(revisionOf(process.cwd())).toMatch(/^[0-9a-f]{40}(\+[0-9a-f]{12})?$/);
  });
});

describe("how the benchmark reports", () => {
  it("records every setting a measurement was taken with, the warm-up among them", () => {
    const options = { seed: "1", docs: "1000", iterations: "3000", warmup: "300", "rest-iterations": "600", "max-load": "8", revision: "abc" };
    expect(reportSettings(options)).toEqual({ revision: "abc", seed: 1, docs: 1000, iterations: 3000, warmup: 300, restIterations: 600, maxLoad: 8 });
  });

  const verdict = rows => ({ verdict: { reads: rows } });
  const row = (read, v) => ({ read, gates: read.startsWith("direct"), verdict: v, ratio: 1, spread: { main: 0, "per-language": 0 } });

  it("passes only when every gating read on every database passes", () => {
    expect(overallCall({ sqlite: verdict([row("direct list", "pass"), row("rest list", "over")]) })).toBe("pass");
    expect(overallCall({ sqlite: verdict([row("direct list", "pass")]), mysql: verdict([row("direct detail", "over")]) })).toBe("over");
    expect(overallCall({ sqlite: verdict([row("direct list", "pass"), row("direct detail", "inconclusive")]) })).toBe("inconclusive");
  });

  it("puts each read's medians, ratio, spread and verdict in one row", () => {
    const runs = [run(10, 11), run(10, 11), run(10, 11)];
    const lines = tableLines({ sqlite: { runs, verdict: { reads: [{ read: "direct list", gates: true, verdict: "pass", ratio: 1.1, spread: { main: 0, "per-language": 0.02 } }] } } });
    expect(lines[2]).toBe("| sqlite | direct list | 5.00 / 10.00 ms | 5.50 / 11.00 ms | 1.100 | 0.0%, 2.0% | pass |");
  });
});
