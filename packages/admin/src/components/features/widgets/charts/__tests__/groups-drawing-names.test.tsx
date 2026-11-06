/**
 * A chart of groups' names: a column as wide as the longest name, up to two fifths of the
 * drawing, a longer name cut with "…" and kept whole in its `<title>`, and every name whole in
 * its `aria-label`.
 *
 * Measured with a stand-in canvas whose every character is 7 px wide, so each width and each cut
 * is known, at the `CHART_WIDTH` the engine's container measures here: a column of at most 128 px.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CardTierContext } from "../../frame/tier";
import { nameColumnWidth } from "../drawn/groups-drawing";
import { GroupsChart, type GroupsChartGroup } from "../groups-chart";

import { CHART_WIDTH, sizeChartsInTests } from "./chart-env";

/** Every character is 7 px wide, in any font. */
const CHAR = 7;

beforeAll(() => {
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return {
          font: "",
          measureText: (text: string) => ({ width: [...text].length * CHAR }),
        };
      }
    }
  );
});
sizeChartsInTests();
afterEach(() => cleanup());

/** The most the names' column may take at `CHART_WIDTH`: two fifths of it. */
const CAP = Math.floor(CHART_WIDTH * 0.4);
/** The room between a name and its bar. */
const GAP = 8;

const groups = (labels: string[]): GroupsChartGroup[] =>
  labels.map((label, index) => ({
    key: `v${index}`,
    value: `v${index}`,
    label,
    count: labels.length - index,
  }));

/** Draws the chart of `labels` and waits for the engine's drawing, which loads lazily. */
async function drawn(labels: string[]): Promise<HTMLElement> {
  render(
    <CardTierContext.Provider value="medium">
      <GroupsChart
        title="Issues"
        labelHeading="Issue"
        groups={groups(labels)}
      />
    </CardTierContext.Provider>
  );
  return screen.findByTestId("chart-drawing");
}

/** Where the bars start, which is where the names' column ends. */
const barsStart = (drawing: HTMLElement) =>
  [...drawing.querySelectorAll(".recharts-bar-rectangle path")].map(bar =>
    Math.round(Number(bar.getAttribute("x")))
  );

/** The names as drawn, each name's `aria-label`, and the `<title>` of each name that is cut. */
const names = (drawing: HTMLElement) => {
  const axis = drawing.querySelectorAll(".recharts-yAxis-tick-labels")[0];
  const texts = [...(axis?.querySelectorAll("text") ?? [])];
  return {
    drawn: texts.map(t => t.textContent),
    labels: texts.map(t => t.getAttribute("aria-label")),
    titles: [...(axis?.querySelectorAll("g > title") ?? [])].map(
      t => t.textContent
    ),
  };
};

const LONG = [
  "Missing meta description",
  "Missing meta title",
  "Missing social image",
];

describe("a chart of groups' names", () => {
  it("take a column no wider than two fifths of the drawing, however long", async () => {
    const drawing = await drawn(LONG);

    expect(barsStart(drawing)).toEqual(LONG.map(() => CAP));
  });

  it("are cut with … to that column, each still whole in its title", async () => {
    // 🔴 Two names that share their first words must not draw the same: a fixed narrow column
    // cut both to "Missing me…", which a reader cannot tell apart.
    const { drawn: written, labels, titles } = names(await drawn(LONG));

    // 120 px of name, 17 characters with "…".
    expect(written).toEqual([
      "Missing meta des…",
      "Missing meta tit…",
      "Missing social i…",
    ]);
    expect(new Set(written).size).toBe(LONG.length);
    expect(titles).toEqual(LONG);
    expect(labels).toEqual(LONG);
  });

  it("take a column only as wide as the longest of them when they are short", async () => {
    // "Published", 63 px, and the gap before its bar.
    const drawing = await drawn(["Published", "Draft"]);

    expect(barsStart(drawing)).toEqual([9 * CHAR + GAP, 9 * CHAR + GAP]);
    // Drawn whole, so named whole by their text and their label, with no second copy as a title.
    expect(names(drawing)).toEqual({
      drawn: ["Published", "Draft"],
      labels: ["Published", "Draft"],
      titles: [],
    });
  });
});

describe("the names' column width", () => {
  it("is the longest name and its gap, held to two fifths of the drawing", () => {
    expect(nameColumnWidth(["Draft", "Published"], 320, "12px Inter")).toBe(
      9 * CHAR + GAP
    );
    expect(nameColumnWidth(LONG, 320, "12px Inter")).toBe(128);
    expect(nameColumnWidth(LONG, 1000, "12px Inter")).toBe(24 * CHAR + GAP);
  });
});
