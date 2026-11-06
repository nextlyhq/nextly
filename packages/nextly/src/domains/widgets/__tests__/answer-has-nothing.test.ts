import { describe, expect, it } from "vitest";

import { answerHasNothing, type WidgetResult } from "../result";

describe("an answer that holds nothing a core display would draw", () => {
  it("is a list with no items, groups with no bucket, or a series with no point", () => {
    const empty: WidgetResult[] = [
      { op: "list", items: [] },
      { op: "groupBy", buckets: [] },
      { op: "timeseries", points: [], interval: "day" },
    ];
    for (const result of empty) {
      expect(answerHasNothing(result), result.op).toBe(true);
    }
  });

  it("is not one that holds a row, a bucket or a point, even a zero", () => {
    const held: WidgetResult[] = [
      { op: "list", items: [{ title: "First" }] },
      { op: "groupBy", buckets: [{ value: "paid", count: 0 }] },
      {
        op: "timeseries",
        points: [{ start: "2026-10-01T00:00:00.000Z", count: 0 }],
        interval: "day",
      },
    ];
    for (const result of held) {
      expect(answerHasNothing(result), result.op).toBe(false);
    }
  });

  it("is never a count, whose number is drawn even at zero, nor a widget's own data", () => {
    expect(answerHasNothing({ op: "count", total: 0 })).toBe(false);
    expect(answerHasNothing({ op: "data", data: {} })).toBe(false);
  });
});
