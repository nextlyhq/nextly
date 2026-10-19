/**
 * A chart over time: its axis, its latest point, its legend and its words.
 *
 * Each test names the property it separates: an axis drawn at the small tier where it does not
 * fit, a latest point labelled at small where the figures above say it, a legend on a single
 * series, a series coloured outside the shared slots.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardTierContext } from "../../frame/tier";
import {
  OverTimeChart,
  type OverTimeInterval,
  type OverTimeSeries,
} from "../over-time-chart";

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

function drawAt(
  tier: SizeTier,
  lines: OverTimeSeries[],
  intervals = days(spanOf(lines))
) {
  render(
    <CardTierContext.Provider value={tier}>
      <OverTimeChart
        title="Posts created"
        intervals={intervals}
        series={lines}
      />
    </CardTierContext.Provider>
  );
}

describe("the value axis", () => {
  it.each<SizeTier>(["medium", "large"])(
    "labels zero and the highest value at %s",
    tier => {
      drawAt(tier, [series("Posts", [2, 9, 4])]);
      const axis = screen.getByTestId("chart-value-axis");
      expect(axis).toHaveTextContent("9");
      expect(axis).toHaveTextContent("0");
      expect(screen.getByTestId("chart-gridlines")).toBeInTheDocument();
    }
  );

  it("is left out at small, where it does not fit", () => {
    drawAt("small", [series("Posts", [2, 9, 4])]);
    expect(screen.queryByTestId("chart-value-axis")).toBeNull();
  });

  it("is HTML outside the stretched drawing, so it keeps its size on every card", () => {
    // A label inside the viewBox would be scaled with the card's width.
    drawAt("medium", [series("Posts", [2, 9, 4])]);
    expect(screen.getByTestId("chart-value-axis").closest("svg")).toBeNull();
  });

  it("draws its gridlines in the border token, never a chart colour", () => {
    drawAt("medium", [series("Posts", [2, 9, 4])]);
    const lines = screen
      .getByTestId("chart-gridlines")
      .querySelectorAll("line");
    expect([...lines].map(line => line.getAttribute("stroke"))).toEqual([
      "var(--nx-border)",
      "var(--nx-border)",
    ]);
  });
});

describe("the latest point", () => {
  it.each<SizeTier>(["small", "medium", "large"])("is circled at %s", tier => {
    drawAt(tier, [series("Posts", [2, 9, 4])]);
    expect(screen.getByTestId("chart-latest-point")).toBeInTheDocument();
  });

  it("is labelled with its value at medium and large, not at small", () => {
    drawAt("medium", [series("Posts", [2, 9, 4])]);
    expect(screen.getByTestId("chart-latest-label")).toHaveTextContent("4");
    cleanup();
    drawAt("small", [series("Posts", [2, 9, 4])]);
    expect(screen.queryByTestId("chart-latest-label")).toBeNull();
  });

  it("is a circle for a single point, which draws no line", () => {
    drawAt("medium", [series("Posts", [7])]);
    expect(screen.getByTestId("chart-latest-point")).toHaveClass(
      "rounded-full"
    );
  });
});

describe("series and their colours", () => {
  it("draws one series in the first chart colour, with no legend", () => {
    drawAt("medium", [series("Posts", [2, 9, 4])]);
    expect(screen.queryByTestId("chart-legend")).toBeNull();
    expect(screen.getByTestId("chart-series").style.color).toBe(
      "var(--nx-chart-1)"
    );
  });

  it.each<SizeTier>(["small", "medium", "large"])(
    "names several series in a legend above the chart at %s",
    tier => {
      drawAt(tier, [series("Posts", [2, 9]), series("Pages", [1, 3])]);
      const legend = screen.getByTestId("chart-legend");
      expect(legend).toHaveTextContent("Posts");
      expect(legend).toHaveTextContent("Pages");
      // The same position on every chart: the first thing in the figure's drawing.
      expect(legend.parentElement?.firstElementChild).toBe(legend);
    }
  );

  it("draws each series in its own shared slot, in turn", () => {
    drawAt("medium", [series("Posts", [2, 9]), series("Pages", [1, 3])]);
    expect(
      screen.getAllByTestId("chart-series").map(line => line.style.color)
    ).toEqual(["var(--nx-chart-1)", "var(--nx-chart-2)"]);
  });
});

describe("the text alternative", () => {
  it("states the range, the total, the latest and the highest", () => {
    drawAt("medium", [series("Posts", [2, 9, 4])]);
    expect(screen.getByRole("img")).toHaveAccessibleDescription(
      "Posts created, Day 1 to Day 3: 15 in total. Latest 4 on Day 3; highest 9 on Day 2."
    );
  });
});

describe("a single point's value", () => {
  it("is written beside its marker, not across the chart from it", () => {
    // One point sits at the left edge, so its label is anchored on the left too.
    drawAt("medium", [series("Posts", [7])]);
    const marker = screen.getByTestId("chart-latest-point");
    const label = screen.getByTestId("chart-latest-label");
    expect(label.style.left).toBe(marker.style.left);
    expect(label.style.right).toBe("");
  });
});

describe("several series over one range", () => {
  /** The x of each point a series' line passes through, from its path. */
  const xs = (line: Element) =>
    [
      ...(
        line.querySelector("path[fill='none']")?.getAttribute("d") ?? ""
      ).matchAll(/[ML]\s*([\d.]+)/g),
    ].map(match => Number(match[1]));

  it("places each point by its interval, not by its position in its own series", () => {
    // Pages has no Day 1: its first point is Day 2, drawn where Posts draws Day 2.
    drawAt("medium", [series("Posts", [2, 9, 4]), series("Pages", [1, 1], 2)]);
    const [postsLine, pagesLine] = screen.getAllByTestId("chart-series");
    expect(xs(pagesLine as Element)).toEqual(xs(postsLine as Element).slice(1));
  });

  it("places a series that shares no interval with the others in its own place in the range", () => {
    // Posts has Days 1 and 2 and Pages only Days 3 and 4: Pages is drawn after Posts, not before.
    drawAt("medium", [series("Posts", [2, 4], 1), series("Pages", [1, 1], 3)]);
    const [postsLine, pagesLine] = screen.getAllByTestId("chart-series");
    const lastPost = xs(postsLine as Element).at(-1) ?? Infinity;
    expect(xs(pagesLine as Element).every(x => x > lastPost)).toBe(true);
  });

  it("does not move a point when the series are given in another order", () => {
    const posts = series("Posts", [2, 4], 1);
    const pages = series("Pages", [1, 1], 3);
    drawAt("medium", [posts, pages]);
    const before = screen.getAllByTestId("chart-series").map(line => xs(line));
    cleanup();
    drawAt("medium", [pages, posts]);
    const after = screen.getAllByTestId("chart-series").map(line => xs(line));
    expect(after).toEqual([before[1], before[0]]);
  });

  it.each<SizeTier>(["small", "medium", "large"])(
    "names each series' latest value in the legend at %s, and labels none on the chart",
    tier => {
      // Two latest values a pixel apart would overprint each other beside the chart.
      drawAt(tier, [series("Posts", [2, 100]), series("Pages", [1, 99])]);
      const legend = screen.getByTestId("chart-legend");
      expect(legend).toHaveTextContent(/Posts\s*100/);
      expect(legend).toHaveTextContent(/Pages\s*99/);
      expect(screen.queryByTestId("chart-latest-label")).toBeNull();
    }
  );
});

describe("the table's rows", () => {
  it("keep apart two rows whose series and point keys join to the same text", () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    drawAt(
      "medium",
      [
        { key: "a:b", name: "First", points: [{ key: "c", value: 1 }] },
        { key: "a", name: "Second", points: [{ key: "b:c", value: 2 }] },
      ],
      [
        { key: "c", label: "Day 1" },
        { key: "b:c", label: "Day 2" },
      ]
    );
    expect(
      errors.mock.calls.some(call => String(call[0]).includes("same key"))
    ).toBe(false);
    errors.mockRestore();
  });
});
