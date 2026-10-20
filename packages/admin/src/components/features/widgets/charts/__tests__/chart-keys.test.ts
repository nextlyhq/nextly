/**
 * How the arrow keys move through a focused chart.
 *
 * One tab stop per chart; inside it the keys move the current point. Along a
 * series with Left and Right, between series with Up and Down where there are
 * several, to the ends with Home and End. Nothing wraps: at the last point,
 * Right stays, so holding a key never sends a reader back to the start
 * unannounced.
 */
import { describe, expect, it } from "vitest";

import { firstPosition, moveInChart, type ChartShape } from "../chart-keys";

const ONE_SERIES: ChartShape = { kind: "points", series: 1, points: 8 };
const THREE_SERIES: ChartShape = { kind: "points", series: 3, points: 8 };
const BARS: ChartShape = { kind: "bars", bars: 5 };

describe("where reading starts", () => {
  it("is the latest point of the first series over time", () => {
    expect(firstPosition(ONE_SERIES)).toEqual({ series: 0, index: 7 });
  });

  it("is the first bar, the highest, in a chart of groups", () => {
    expect(firstPosition(BARS)).toEqual({ series: 0, index: 0 });
  });
});

describe("over time", () => {
  it("moves along the series with Left and Right, and to its ends with Home and End", () => {
    const at = { series: 0, index: 3 };
    expect(moveInChart(at, "ArrowLeft", ONE_SERIES)).toEqual({
      series: 0,
      index: 2,
    });
    expect(moveInChart(at, "ArrowRight", ONE_SERIES)).toEqual({
      series: 0,
      index: 4,
    });
    expect(moveInChart(at, "Home", ONE_SERIES)).toEqual({
      series: 0,
      index: 0,
    });
    expect(moveInChart(at, "End", ONE_SERIES)).toEqual({ series: 0, index: 7 });
  });

  it("does not wrap at either end", () => {
    expect(
      moveInChart({ series: 0, index: 7 }, "ArrowRight", ONE_SERIES)
    ).toEqual({
      series: 0,
      index: 7,
    });
    expect(
      moveInChart({ series: 0, index: 0 }, "ArrowLeft", ONE_SERIES)
    ).toEqual({
      series: 0,
      index: 0,
    });
  });

  it("moves between series with Up and Down, keeping the point in time", () => {
    // 🔴 With several series, Up and Down change series, not time.
    const at = { series: 1, index: 4 };
    expect(moveInChart(at, "ArrowUp", THREE_SERIES)).toEqual({
      series: 0,
      index: 4,
    });
    expect(moveInChart(at, "ArrowDown", THREE_SERIES)).toEqual({
      series: 2,
      index: 4,
    });
    expect(
      moveInChart({ series: 2, index: 4 }, "ArrowDown", THREE_SERIES)
    ).toEqual({
      series: 2,
      index: 4,
    });
  });

  it("with one series, lets Up and Down move along it too", () => {
    // So a reader who tries the vertical arrows first is not met with silence.
    const at = { series: 0, index: 3 };
    expect(moveInChart(at, "ArrowUp", ONE_SERIES)).toEqual({
      series: 0,
      index: 4,
    });
    expect(moveInChart(at, "ArrowDown", ONE_SERIES)).toEqual({
      series: 0,
      index: 2,
    });
  });
});

describe("a chart of groups", () => {
  it("moves bar by bar with any arrow, top to bottom, and to the ends with Home and End", () => {
    const at = { series: 0, index: 2 };
    expect(moveInChart(at, "ArrowDown", BARS)).toEqual({ series: 0, index: 3 });
    expect(moveInChart(at, "ArrowRight", BARS)).toEqual({
      series: 0,
      index: 3,
    });
    expect(moveInChart(at, "ArrowUp", BARS)).toEqual({ series: 0, index: 1 });
    expect(moveInChart(at, "ArrowLeft", BARS)).toEqual({ series: 0, index: 1 });
    expect(moveInChart(at, "Home", BARS)).toEqual({ series: 0, index: 0 });
    expect(moveInChart(at, "End", BARS)).toEqual({ series: 0, index: 4 });
    expect(moveInChart({ series: 0, index: 4 }, "ArrowDown", BARS)).toEqual({
      series: 0,
      index: 4,
    });
  });
});

describe("any other key", () => {
  it("is not a move, so the chart leaves it to the page", () => {
    // Escape belongs to the tooltip; Tab leaves the chart.
    for (const key of ["Escape", "Tab", "Enter", "a"]) {
      expect(
        moveInChart({ series: 0, index: 1 }, key, ONE_SERIES)
      ).toBeUndefined();
    }
  });

  it("is no move in an empty chart", () => {
    expect(firstPosition({ kind: "bars", bars: 0 })).toBeUndefined();
    expect(
      moveInChart({ series: 0, index: 0 }, "ArrowRight", {
        kind: "bars",
        bars: 0,
      })
    ).toBeUndefined();
  });
});
