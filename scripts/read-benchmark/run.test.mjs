import { describe, expect, it } from "vitest";

import { needsAnotherRun, orderFor, overallCall, runsAgree, tableLines } from "./run.mjs";

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
    const limits = { minRuns: 3, maxRuns: 5, spreadLimit: 0.05 };
    const agreeing = [run(10, 11), run(10, 11), run(10, 11)];
    const disagreeing = [run(10, 11), run(12, 11), run(10, 11)];
    expect(needsAnotherRun(agreeing.slice(0, 2), limits)).toBe(true);
    expect(needsAnotherRun(agreeing, limits)).toBe(false);
    expect(needsAnotherRun(disagreeing, limits)).toBe(true);
    expect(needsAnotherRun([...disagreeing, run(12, 11), run(10, 11)], limits)).toBe(false);
  });
});

describe("how the benchmark reports", () => {
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
