/**
 * An over-time card at each tier: a small card is the latest value, the total over the range
 * and a line with no dates; a medium one dates the line's two ends; a large one adds dates
 * between them.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetResult,
} from "@admin/types/dashboard/widgets";

import { sizeChartsInTests } from "../../charts/__tests__/chart-env";
import { CardTierContext } from "../../frame/tier";
import { timeseriesBody } from "../timeseries";

sizeChartsInTests();
afterEach(() => cleanup());

const widget = {
  id: "acme/posts-per-day",
  title: "Posts per day",
  archetype: "timeseries",
  query: { source: "collection:posts", op: "timeseries", interval: "day" },
} as DashboardWidget;

// Nine days; the last day holds 4 of the 45 posts.
const counts = [5, 3, 8, 6, 2, 7, 6, 4, 4];
const result: WidgetResult = {
  op: "timeseries",
  interval: "day",
  points: counts.map((count, i) => ({
    start: `2026-10-0${i + 1}T00:00:00.000Z`,
    count,
  })),
};

/** Draws the card's chart at `tier`, and waits for the drawing, which loads lazily. */
async function drawAt(tier: SizeTier): Promise<void> {
  const outcome = timeseriesBody(result, widget);
  if (!outcome.ok || !("node" in outcome) || !outcome.node) {
    throw new Error("the chart drew nothing");
  }
  render(
    <CardTierContext.Provider value={tier}>
      {outcome.node}
    </CardTierContext.Provider>
  );
  await screen.findByTestId("chart-drawing");
}

/** How many dates are written under the line. */
const dates = () =>
  screen
    .getByTestId("chart-drawing")
    .querySelectorAll(".recharts-xAxis-tick-labels text").length;

describe("an over-time card at each tier", () => {
  it("is the latest value and the range's total at small, with no dates under the line", async () => {
    await drawAt("small");
    const summary = screen.getByTestId("timeseries-summary");
    expect(summary).toHaveTextContent("4 latest");
    expect(summary).toHaveTextContent("45 in total");
    expect(dates()).toBe(0);
  });

  it("dates the line's two ends at medium", async () => {
    await drawAt("medium");
    expect(dates()).toBe(2);
    expect(screen.queryByTestId("timeseries-summary")).not.toBeInTheDocument();
  });

  it("adds dates between the ends at large", async () => {
    await drawAt("large");
    // 🔴 More than the two ends, and never every point: nine dates would crowd the axis.
    expect(dates()).toBeGreaterThan(2);
    expect(dates()).toBeLessThan(counts.length);
  });
});
