/**
 * A chart over time: its axis, its latest point, its legend and its words.
 *
 * Each test names the property it separates: an axis drawn at the small tier where it does not
 * fit, a latest point labelled at small where the figures above say it, a legend on a single
 * series, a series coloured outside the shared slots.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CardTierContext } from "../../frame/tier";
import { OverTimeChart, type OverTimeSeries } from "../over-time-chart";

afterEach(() => cleanup());

function series(name: string, values: number[]): OverTimeSeries {
  return {
    key: name,
    name,
    points: values.map((value, i) => ({
      key: `${name}${i}`,
      label: `Day ${i + 1}`,
      value,
    })),
  };
}

function drawAt(tier: SizeTier, lines: OverTimeSeries[]) {
  render(
    <CardTierContext.Provider value={tier}>
      <OverTimeChart title="Posts created" series={lines} />
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
    expect(screen.getByTestId("chart-gridlines")).toHaveClass("text-border");
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
