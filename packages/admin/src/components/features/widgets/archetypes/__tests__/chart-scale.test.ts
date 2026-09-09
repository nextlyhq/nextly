/**
 * The chart arithmetic, asked the questions a rendered SVG cannot answer.
 *
 * jsdom performs no layout, so a chart drawn upside down, one that overflows
 * its own viewBox, and one that divides by zero all render identically to a
 * correct one. These assertions are on the numbers for that reason.
 */

import { describe, expect, it } from "vitest";

import {
  areaPath,
  barFractions,
  linePath,
  linePoints,
  type ChartBox,
} from "../chart-scale";

const BOX: ChartBox = { width: 100, height: 40, padding: 4 };

describe("bar lengths", () => {
  it("gives the largest bucket the full track", () => {
    expect(barFractions([5, 10, 1])).toEqual([0.5, 1, 0.1]);
  });

  it("draws nothing rather than dividing by zero when every bucket is empty", () => {
    // A real first-day dashboard: the collection exists and has no rows. The
    // defect this catches is `0/0`, which is NaN and reaches the DOM as a
    // width of "NaN%" -- a bar of unpredictable length rather than none.
    expect(barFractions([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("keeps a bar inside its track whatever arrives", () => {
    // Every fraction is a width, so one above 1 overflows the card and one
    // below 0 inverts the bar. Neither can come from a count today, which is
    // exactly why nothing else would catch it.
    for (const fraction of barFractions([-4, 0, 7, Number.NaN, Infinity])) {
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });

  it("has no bars for no buckets", () => {
    expect(barFractions([])).toEqual([]);
  });
});

describe("line geometry", () => {
  it("puts a LARGER count higher up the chart", () => {
    // SVG's y axis grows downward, so the correct chart and the upside-down one
    // differ by a single minus sign and both look like charts.
    const [low, high] = linePoints([1, 9], BOX);
    expect(high.y).toBeLessThan(low.y);
  });

  it("measures from zero rather than from the smallest value", () => {
    // A baseline at the minimum turns 100 vs 102 into a cliff. For counts, zero
    // is meaningful and reachable, so it is the floor.
    const [a, b] = linePoints([100, 102], BOX);
    const span = Math.abs(a.y - b.y);
    expect(span).toBeLessThan(BOX.height / 10);
  });

  it("spans the full width and stays inside the padding", () => {
    const points = linePoints([1, 2, 3, 4], BOX);
    expect(points[0].x).toBe(BOX.padding);
    expect(points[points.length - 1].x).toBe(BOX.width - BOX.padding);
    for (const point of points) {
      expect(point.y).toBeGreaterThanOrEqual(BOX.padding);
      expect(point.y).toBeLessThanOrEqual(BOX.height - BOX.padding);
    }
  });

  it("draws an all-zero window as a flat line on the baseline", () => {
    // Zero means NO ROWS, never unknown -- the whole window was read. So this
    // is a real answer to draw, not a reason to render nothing.
    const points = linePoints([0, 0, 0], BOX);
    const baseline = BOX.height - BOX.padding;
    expect(points.map(p => p.y)).toEqual([baseline, baseline, baseline]);
  });

  it("places a single interval without dividing by a zero span", () => {
    // One interval is a legal window. The span between points is `n - 1`, so
    // this is the input that divides by zero.
    const points = linePoints([3], BOX);
    expect(points).toHaveLength(1);
    expect(Number.isFinite(points[0].x)).toBe(true);
    expect(Number.isFinite(points[0].y)).toBe(true);
  });

  it("has no points for an empty window", () => {
    expect(linePoints([], BOX)).toEqual([]);
  });
});

describe("path strings", () => {
  it("moves once and then draws", () => {
    const path = linePath(linePoints([0, 1], BOX));
    expect(path.startsWith("M ")).toBe(true);
    expect(path.match(/M /g)).toHaveLength(1);
    expect(path).toContain("L ");
  });

  it("emits no path at all for an empty series", () => {
    // "" is falsy, so the component can decline to render the element rather
    // than emitting a `<path d="">` that some engines warn about.
    expect(linePath([])).toBe("");
  });

  it("rounds coordinates so a path can be compared and stays small", () => {
    // A third of a span produces 31.999999999999996 without this.
    const path = linePath(linePoints([1, 2, 3, 4], { ...BOX, width: 100 }));
    expect(path).not.toMatch(/\d\.\d{3,}/);
  });

  it("closes an area down to the baseline", () => {
    const points = linePoints([1, 2], BOX);
    const area = areaPath(points, BOX.height - BOX.padding);
    expect(area.endsWith("Z")).toBe(true);
    expect(area).toContain(`,${BOX.height - BOX.padding}`);
  });

  it("fills nothing when a single point encloses no area", () => {
    expect(areaPath(linePoints([5], BOX), 36)).toBe("");
  });
});
