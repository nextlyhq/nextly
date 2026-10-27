/**
 * A chart over time: its axis, its latest point, its legend and its words.
 *
 * Each test names the property it separates: an axis drawn at the small tier where it does not
 * fit, a latest point labelled at small where the figures above say it, a legend on a single
 * series, a series coloured outside the shared slots, a point placed by its position in its own
 * series rather than by its interval.
 *
 * The marks are the chart engine's, read from what it draws at `CHART_WIDTH`.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import type { SizeTier } from "@nextlyhq/ui/format";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardTierContext } from "../../frame/tier";
import {
  OverTimeChart,
  type OverTimeInterval,
  type OverTimeSeries,
} from "../over-time-chart";

import {
  CHART_WIDTH,
  prefersReducedMotion,
  sizeChartsInTests,
} from "./chart-env";

sizeChartsInTests();
afterEach(() => cleanup());

/** A series of `values` on consecutive days, its first on day `from`. */
function series(name: string, values: number[], from = 1): OverTimeSeries {
  return {
    key: name,
    name,
    points: values.map((value, i) => ({ key: `d${from + i}`, value })),
  };
}

/** Days 1 to `count`, in order: the range every series is drawn against. */
function days(count: number): OverTimeInterval[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `d${i + 1}`,
    label: `Day ${i + 1}`,
  }));
}

/** The days the series reach, from Day 1. */
function spanOf(lines: OverTimeSeries[]): number {
  return Math.max(
    0,
    ...lines.flatMap(line =>
      line.points.map(point => Number(point.key.slice(1)))
    )
  );
}

/** Draws the chart at `tier` and waits for the engine's drawing, which loads lazily. */
async function drawAt(
  tier: SizeTier,
  lines: OverTimeSeries[],
  {
    intervals = days(spanOf(lines)),
    chartStyle = "line" as "line" | "bars",
  } = {}
): Promise<HTMLElement> {
  render(
    <ShortcutProvider>
      <CardTierContext.Provider value={tier}>
        <OverTimeChart
          title="Posts created"
          intervals={intervals}
          series={lines}
          chartStyle={chartStyle}
        />
      </CardTierContext.Provider>
    </ShortcutProvider>
  );
  return screen.findByTestId("chart-drawing");
}

/** The text of every value-axis label the drawing writes. */
const valueLabels = (drawing: HTMLElement) =>
  [...drawing.querySelectorAll(".recharts-yAxis-tick-labels text")].map(
    text => text.textContent
  );

/** Each line's x at every point it passes through, from its path. */
const xsOf = (path: Element) =>
  [...(path.getAttribute("d") ?? "").matchAll(/[ML]\s*([\d.]+)/g)].map(match =>
    Number(match[1])
  );

/** The drawn lines, one per series: the stroke of an area or of a line. */
const linesIn = (drawing: HTMLElement) => [
  ...drawing.querySelectorAll(".recharts-area-curve, .recharts-line-curve"),
];

describe("the value axis", () => {
  it.each<SizeTier>(["medium", "large"])(
    "labels zero and a value above the highest at %s, over gridlines in the border token",
    async tier => {
      const drawing = await drawAt(tier, [series("Posts", [2, 9, 4])]);
      const labels = valueLabels(drawing).map(Number);
      expect(labels).toContain(0);
      expect(Math.max(...labels)).toBeGreaterThanOrEqual(9);
      const gridlines = [
        ...drawing.querySelectorAll(".recharts-cartesian-grid line"),
      ];
      expect(gridlines.length).toBeGreaterThan(0);
      expect(
        new Set(gridlines.map(line => line.getAttribute("stroke")))
      ).toEqual(new Set(["var(--nx-border)"]));
    }
  );

  it("is left out at small, with its gridlines and dates, where they do not fit", async () => {
    const drawing = await drawAt("small", [series("Posts", [2, 9, 4])]);
    expect(valueLabels(drawing)).toEqual([]);
    expect(drawing.querySelector(".recharts-cartesian-grid")).toBeNull();
    expect(drawing.querySelector(".recharts-xAxis-tick-labels")).toBeNull();
  });

  it("starts at zero, so a small change is not drawn as a cliff", async () => {
    const drawing = await drawAt("medium", [series("Posts", [100, 102])]);
    expect(valueLabels(drawing)[0]).toBe("0");
  });
});

describe("the dates under the chart", () => {
  it.each<[SizeTier, string[]]>([
    ["medium", ["Day 1", "Day 9"]],
    ["large", ["Day 1", "Day 5", "Day 9"]],
  ])(
    "at %s are %j, the first and last held inside the drawing",
    async (tier, expected) => {
      const drawing = await drawAt(tier, [
        series("Posts", [1, 2, 3, 4, 5, 6, 7, 8, 9]),
      ]);
      const dates = [
        ...drawing.querySelectorAll(".recharts-xAxis-tick-labels text"),
      ];
      expect(dates.map(date => date.textContent)).toEqual(expected);
      expect(dates[0]?.getAttribute("text-anchor")).toBe("start");
      expect(dates.at(-1)?.getAttribute("text-anchor")).toBe("end");
    }
  );
});

describe("the latest point", () => {
  it.each<SizeTier>(["small", "medium", "large"])(
    "is circled at %s, on the card's surface in its series' colour",
    async tier => {
      const drawing = await drawAt(tier, [series("Posts", [2, 9, 4])]);
      const point = drawing.querySelector(".recharts-reference-dot-dot");
      expect(point).not.toBeNull();
      expect(point?.getAttribute("fill")).toBe("var(--nx-card)");
      expect(point?.getAttribute("stroke")).toBe("var(--color-s0)");
    }
  );

  it("is labelled with its value at medium and large, not at small", async () => {
    let drawing = await drawAt("medium", [series("Posts", [2, 9, 4])]);
    expect(drawing.querySelector(".recharts-label")).toHaveTextContent("4");
    cleanup();
    drawing = await drawAt("small", [series("Posts", [2, 9, 4])]);
    expect(drawing.querySelector(".recharts-label")).toBeNull();
  });

  it("is a circle for a single point, which draws no line", async () => {
    const drawing = await drawAt("medium", [series("Posts", [7])]);
    expect(drawing.querySelector(".recharts-reference-dot-dot")).not.toBeNull();
  });

  it("is a true circle: the drawing is the card's own width, never a stretched box", async () => {
    // 🔴 A viewBox stretched to the card drew a circle as an ellipse and scaled every label.
    const drawing = await drawAt("medium", [series("Posts", [2, 9, 4])]);
    const surface = drawing.querySelector("svg.recharts-surface");
    expect(surface?.getAttribute("viewBox")).toBe(
      `0 0 ${CHART_WIDTH} ${surface?.getAttribute("height")}`
    );
  });
});

describe("a single point's value", () => {
  it("is written beside its marker, on the side the chart has room", async () => {
    // One point sits at the left edge, so its label is written to its right.
    const drawing = await drawAt("medium", [series("Posts", [7])]);
    const marker = drawing.querySelector(".recharts-reference-dot-dot");
    const label = drawing.querySelector(".recharts-label");
    expect(label?.getAttribute("text-anchor")).toBe("start");
    expect(Number(label?.getAttribute("x"))).toBeGreaterThan(
      Number(marker?.getAttribute("cx"))
    );
  });

  it("at the right edge is written to its left, not off the card", async () => {
    const drawing = await drawAt("medium", [series("Posts", [2, 9, 4])]);
    const marker = drawing.querySelector(".recharts-reference-dot-dot");
    const label = drawing.querySelector(".recharts-label");
    expect(label?.getAttribute("text-anchor")).toBe("end");
    expect(Number(label?.getAttribute("x"))).toBeLessThan(
      Number(marker?.getAttribute("cx"))
    );
  });
});

describe("series and their colours", () => {
  it("draws one series as an area in the first chart colour, with no legend", async () => {
    const drawing = await drawAt("medium", [series("Posts", [2, 9, 4])]);
    expect(screen.queryByTestId("chart-legend")).toBeNull();
    expect(drawing.style.getPropertyValue("--color-s0")).toBe(
      "var(--nx-chart-1)"
    );
    expect(
      drawing.querySelector(".recharts-area-area")?.getAttribute("fill")
    ).toBe("var(--color-s0)");
    expect(linesIn(drawing).map(line => line.getAttribute("stroke"))).toEqual([
      "var(--color-s0)",
    ]);
  });

  it.each<SizeTier>(["small", "medium", "large"])(
    "names several series in a legend above the chart at %s",
    async tier => {
      await drawAt(tier, [series("Posts", [2, 9]), series("Pages", [1, 3])]);
      const legend = screen.getByTestId("chart-legend");
      expect(legend).toHaveTextContent("Posts");
      expect(legend).toHaveTextContent("Pages");
      // The same position on every chart: the first thing in the figure's drawing.
      expect(legend.parentElement?.firstElementChild).toBe(legend);
    }
  );

  it("draws each series as a line in its own shared slot, in turn, with no area", async () => {
    const drawing = await drawAt("medium", [
      series("Posts", [2, 9]),
      series("Pages", [1, 3]),
    ]);
    expect(
      ["--color-s0", "--color-s1"].map(name =>
        drawing.style.getPropertyValue(name)
      )
    ).toEqual(["var(--nx-chart-1)", "var(--nx-chart-2)"]);
    expect(linesIn(drawing).map(line => line.getAttribute("stroke"))).toEqual([
      "var(--color-s0)",
      "var(--color-s1)",
    ]);
    expect(drawing.querySelector(".recharts-area")).toBeNull();
  });
});

describe("the text alternative", () => {
  it("states the range, the total, the latest and the highest", async () => {
    await drawAt("medium", [series("Posts", [2, 9, 4])]);
    expect(
      screen.getByRole("group", { name: /Use the arrow keys/ })
    ).toHaveAccessibleDescription(
      "Posts created, Day 1 to Day 3: 15 in total. Latest 4 on Day 3; highest 9 on Day 2."
    );
  });
});

describe("several series over one range", () => {
  it("places each point by its interval, not by its position in its own series", async () => {
    // Pages has no Day 1: its first point is Day 2, drawn where Posts draws Day 2.
    const drawing = await drawAt("medium", [
      series("Posts", [2, 9, 4]),
      series("Pages", [1, 1], 2),
    ]);
    const [posts, pages] = linesIn(drawing);
    expect(xsOf(pages as Element)).toEqual(xsOf(posts as Element).slice(1));
  });

  it("places a series that shares no interval with the others in its own place in the range", async () => {
    // Posts has Days 1 and 2 and Pages only Days 3 and 4: Pages is drawn after Posts, not before.
    const drawing = await drawAt("medium", [
      series("Posts", [2, 4], 1),
      series("Pages", [1, 1], 3),
    ]);
    const [posts, pages] = linesIn(drawing);
    const lastPost = xsOf(posts as Element).at(-1) ?? Infinity;
    expect(xsOf(pages as Element).every(x => x > lastPost)).toBe(true);
  });

  it("does not move a point when the series are given in another order", async () => {
    const posts = series("Posts", [2, 4], 1);
    const pages = series("Pages", [1, 1], 3);
    const before = linesIn(await drawAt("medium", [posts, pages])).map(xsOf);
    cleanup();
    const after = linesIn(await drawAt("medium", [pages, posts])).map(xsOf);
    expect(after).toEqual([before[1], before[0]]);
  });

  it.each<SizeTier>(["small", "medium", "large"])(
    "names each series' latest value in the legend at %s, and labels none on the chart",
    async tier => {
      // Two latest values a pixel apart would overprint each other beside the chart.
      const drawing = await drawAt(tier, [
        series("Posts", [2, 100]),
        series("Pages", [1, 99]),
      ]);
      const legend = screen.getByTestId("chart-legend");
      expect(legend).toHaveTextContent(/Posts\s*100/);
      expect(legend).toHaveTextContent(/Pages\s*99/);
      expect(drawing.querySelector(".recharts-label")).toBeNull();
    }
  );
});

describe("bars", () => {
  /** Each bar's left edge and width, from the engine's rectangles. */
  const barsIn = (drawing: HTMLElement) =>
    [...drawing.querySelectorAll(".recharts-bar-rectangle path")].map(bar => ({
      x: Number(bar.getAttribute("x")),
      width: Number(bar.getAttribute("width")),
    }));

  it("stands every bar inside the drawing, the first and last as wide as the rest", async () => {
    // 🔴 Centred on a line's edge-to-edge points, the first and last bars of a week
    // started outside the drawing and were cut to about two thirds of the others.
    const drawing = await drawAt(
      "medium",
      [series("Posts", [1, 2, 3, 4, 5, 6, 7])],
      {
        chartStyle: "bars",
      }
    );
    const bars = barsIn(drawing);
    expect(bars).toHaveLength(7);
    for (const bar of bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(CHART_WIDTH);
      expect(bar.width).toBeCloseTo(bars[0]?.width ?? 0);
    }
  });

  it("stands the rule through the keyboard's interval on its own bar, the first and last included", async () => {
    // 🔴 The point in view placed on another scale than the bars would mark the wrong bar.
    const drawing = await drawAt(
      "medium",
      [series("Posts", [1, 2, 3, 4, 5, 6, 7])],
      {
        chartStyle: "bars",
      }
    );
    const centres = barsIn(drawing).map(bar => bar.x + bar.width / 2);
    const area = screen.getByRole("group", { name: /Use the arrow keys/ });
    act(() => area.focus());
    // The keys start on the latest interval and Home goes to the first.
    for (const [key, index] of [
      ["", 6],
      ["{Home}", 0],
      ["{ArrowRight}{ArrowRight}{ArrowRight}", 3],
    ] as const) {
      if (key) await userEvent.setup().keyboard(key);
      // The rule through the interval in view: a dashed line in the muted text token.
      const rule = drawing.querySelector(".chart-rule line");
      expect(rule, `the interval in view at ${index}`).not.toBeNull();
      expect(rule?.getAttribute("stroke")).toBe("var(--nx-muted-foreground)");
      expect(Number(rule?.getAttribute("x1"))).toBeCloseTo(
        centres[index] ?? NaN,
        0
      );
    }
  });
});

/** The width of the clip the engine reveals an area through as it animates it in. */
const revealed = (drawing: HTMLElement) =>
  drawing
    .querySelector(".recharts-area")
    ?.querySelector("clipPath rect")
    ?.getAttribute("width");

describe("motion", () => {
  it("draws without animation while the person asks for reduced motion", async () => {
    const drawing = await drawAt("medium", [series("Posts", [2, 9, 4])]);
    expect(drawing).toHaveAttribute("data-motion", "reduced");
    // Drawn whole at once: the area's line is complete on the first paint.
    expect(xsOf(linesIn(drawing)[0] as Element)).toHaveLength(3);
    expect(revealed(drawing)).not.toBe("0");
  });

  it("animates its marks in otherwise", async () => {
    prefersReducedMotion(false);
    const drawing = await drawAt("medium", [series("Posts", [2, 9, 4])]);
    expect(drawing).toHaveAttribute("data-motion", "animated");
    expect(drawing.querySelector(".recharts-area")).not.toBeNull();
    // Revealed from the left: on the first paint the clip over the area has no width yet.
    expect(revealed(drawing)).toBe("0");
  });
});

describe("the table's rows", () => {
  it("keep apart two rows whose series and point keys join to the same text", async () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await drawAt(
      "medium",
      [
        { key: "a:b", name: "First", points: [{ key: "c", value: 1 }] },
        { key: "a", name: "Second", points: [{ key: "b:c", value: 2 }] },
      ],
      {
        intervals: [
          { key: "c", label: "Day 1" },
          { key: "b:c", label: "Day 2" },
        ],
      }
    );
    expect(
      errors.mock.calls.some(call => String(call[0]).includes("same key"))
    ).toBe(false);
  });
});
