/**
 * A chart over time is as tall as its card's width makes it: its marks' height follows the size
 * tier the card's drawn width reads as, never a stored row count. Read here while the engine
 * loads, where the chart holds the height its marks will take.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { cardTierAt } from "nextly/card-geometry";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardTierContext } from "../../frame/tier";
import { CHART_DATES_HEIGHT, CHART_PLOT_HEIGHTS } from "../chart-config";
import { OverTimeChart } from "../over-time-chart";

/** A drawing that never finishes loading, so the chart's held height is what is read. */
vi.mock("../drawn/over-time-drawing", () => ({
  default: () => {
    throw new Promise(() => undefined);
  },
}));

afterEach(() => cleanup());

const DAYS = [
  { key: "d1", label: "Day 1" },
  { key: "d2", label: "Day 2" },
];
const POSTS = {
  key: "posts",
  name: "Posts",
  points: [
    { key: "d1", value: 2 },
    { key: "d2", value: 9 },
  ],
};

/** The height the chart holds in a card `w` columns wide on a 1,440 px dashboard. */
function heldHeightAt(w: number): number {
  render(
    <CardTierContext.Provider value={cardTierAt(w, 1440)}>
      <OverTimeChart title="Posts created" intervals={DAYS} series={[POSTS]} />
    </CardTierContext.Provider>
  );
  const height = Number.parseFloat(
    screen.getByTestId("chart-pending").style.minHeight
  );
  cleanup();
  return height;
}

describe("a chart over time's height", () => {
  it("follows its card's width: 33%, 50% and 100% wide", () => {
    const third = heldHeightAt(4);
    const half = heldHeightAt(6);
    const full = heldHeightAt(12);
    expect(third).toBe(CHART_PLOT_HEIGHTS.medium + CHART_DATES_HEIGHT);
    expect(half).toBe(CHART_PLOT_HEIGHTS.large + CHART_DATES_HEIGHT);
    expect(full).toBe(CHART_PLOT_HEIGHTS.large + CHART_DATES_HEIGHT);
    expect(half).toBeGreaterThan(third);
  });

  it("is never under its small tier's marks, the dates left out there", () => {
    render(
      <CardTierContext.Provider value="small">
        <OverTimeChart
          title="Posts created"
          intervals={DAYS}
          series={[POSTS]}
        />
      </CardTierContext.Provider>
    );
    expect(screen.getByTestId("chart-pending").style.minHeight).toBe(
      `${CHART_PLOT_HEIGHTS.small}px`
    );
  });

  it("grows with the tier, so a wider card draws taller marks", () => {
    expect(CHART_PLOT_HEIGHTS.small).toBeLessThan(CHART_PLOT_HEIGHTS.medium);
    expect(CHART_PLOT_HEIGHTS.medium).toBeLessThan(CHART_PLOT_HEIGHTS.large);
  });
});
