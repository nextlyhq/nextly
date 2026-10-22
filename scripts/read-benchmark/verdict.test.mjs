import { describe, expect, it } from "vitest";

import { verdictFor } from "./verdict.mjs";

/** Runs whose p95 for one read are `main` and `perLanguage`, run by run. */
function runs(read, main, perLanguage) {
  return main.map((p95, i) => ({
    main: { results: { [read]: { p95 } } },
    "per-language": { results: { [read]: { p95: perLanguage[i] } } },
  }));
}

const only = result => result.reads[0];

describe("the benchmark's verdict", () => {
  it("passes a ratio clearly under the bound", () => {
    const row = only(verdictFor(runs("direct list", [10, 10, 10], [10.5, 10.5, 10.5])));
    expect(row.ratio).toBeCloseTo(1.05, 10);
    expect(row.verdict).toBe("pass");
  });

  it("calls a ratio clearly over the bound over", () => {
    expect(only(verdictFor(runs("direct list", [10, 10, 10], [12, 12, 12]))).verdict).toBe("over");
  });

  it("compares the medians of the runs, so one slow run does not decide it", () => {
    // per-language's middle run is 10.6; its 30 ms outlier is not the median.
    const row = only(verdictFor(runs("direct list", [10, 10.1, 9.9], [10.5, 30, 10.6])));
    expect(row.ratio).toBeCloseTo(10.6 / 10, 10);
  });

  it("calls a ratio within the runs' noise of the bound inconclusive", () => {
    // Ratio 1.09, and the runs spread 6%: half of that reaches past 1.10.
    const row = only(verdictFor(runs("direct list", [9.7, 10, 10.3], [10.9, 10.9, 10.9])));
    expect(row.ratio).toBeCloseTo(1.09, 10);
    expect(row.spread.main).toBeCloseTo(0.06, 10);
    expect(row.verdict).toBe("inconclusive");
  });

  it("does not call a ratio just over the bound over while the runs disagree", () => {
    // Ratio 1.11, and the runs spread 6%: within half of it of 1.10.
    const row = only(verdictFor(runs("direct list", [9.7, 10, 10.3], [11.1, 11.1, 11.1])));
    expect(row.ratio).toBeCloseTo(1.11, 10);
    expect(row.verdict).toBe("inconclusive");
  });

  it("calls the same ratio a pass once the runs agree", () => {
    expect(only(verdictFor(runs("direct list", [10, 10, 10], [10.9, 10.9, 10.9]))).verdict).toBe("pass");
  });

  it("holds the bound it is given", () => {
    expect(only(verdictFor(runs("direct list", [10, 10, 10], [11.5, 11.5, 11.5]), { bound: 0.2 })).verdict).toBe("pass");
  });

  it("gates on the Direct API reads only", () => {
    expect(only(verdictFor(runs("direct detail", [1], [1]))).gates).toBe(true);
    expect(only(verdictFor(runs("rest detail", [1], [1]))).gates).toBe(false);
  });
});
