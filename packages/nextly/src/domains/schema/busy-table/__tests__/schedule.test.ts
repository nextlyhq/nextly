/**
 * When each try for a busy table starts: pauses from about 1 second, doubling to at most about 15,
 * and no try starts unless one whole try still fits before the total bound.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_BUSY_TABLE_BOUNDS } from "../bounds";
import { mayStartTry, pauseAfterTry, plannedTryStarts } from "../schedule";

describe("the schedule of tries", () => {
  it("the default bounds give tries at about 0, 6, 13, 22, 35, 55 and 75 seconds", () => {
    expect(plannedTryStarts(DEFAULT_BUSY_TABLE_BOUNDS)).toEqual([
      0, 6_000, 13_000, 22_000, 35_000, 55_000, 75_000,
    ]);
  });

  it("a try of 1 second and a total of 10 give tries at 0, 2 and 5 seconds", () => {
    expect(plannedTryStarts({ tryMs: 1_000, totalMs: 10_000 })).toEqual([
      0, 2_000, 5_000,
    ]);
  });

  it("a try of 2 seconds and a total of 30 give tries at 0, 3, 7, 13 and 23 seconds", () => {
    expect(plannedTryStarts({ tryMs: 2_000, totalMs: 30_000 })).toEqual([
      0, 3_000, 7_000, 13_000, 23_000,
    ]);
  });

  it("makes one try where the total holds only one", () => {
    expect(plannedTryStarts({ tryMs: 5_000, totalMs: 5_000 })).toEqual([0]);
  });

  it("pauses 1, 2, 4, 8 and then 15 seconds between tries", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(pauseAfterTry)).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000,
    ]);
  });

  it("lets a try start only while a whole try still fits before the total", () => {
    const bounds = DEFAULT_BUSY_TABLE_BOUNDS;
    expect(mayStartTry(bounds, 1_000, 1_000 + 85_000)).toBe(true);
    expect(mayStartTry(bounds, 1_000, 1_000 + 85_001)).toBe(false);
  });
});
