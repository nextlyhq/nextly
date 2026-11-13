/**
 * A chart's series config: each series' key mapped to its label and its mark, and the one
 * colour variable per series that every mark of it reads.
 */
import { describe, expect, it } from "vitest";

import { chartConfigStyle, seriesColour, seriesKey } from "../chart-config";

describe("a chart's series config", () => {
  it("sets one colour variable per series, each its mark's shared token", () => {
    expect(
      chartConfigStyle({
        s0: { label: "Posts", mark: 1 },
        s1: { label: "Pages", mark: 4 },
        s2: { label: "Published", mark: "success" },
      })
    ).toEqual({
      "--color-s0": "var(--nx-chart-1)",
      "--color-s1": "var(--nx-chart-4)",
      "--color-s2": "var(--nx-success-solid)",
    });
  });

  it("draws a series' marks in the variable its container sets, never a colour of their own", () => {
    expect(seriesColour("s1")).toBe("var(--color-s1)");
  });

  it("keys a series by its place, so a stored value never becomes a CSS name", () => {
    // 🔴 A series named "a b" or "50%" keyed by its name would set an invalid custom property.
    expect([0, 1, 12].map(seriesKey)).toEqual(["s0", "s1", "s12"]);
  });
});
