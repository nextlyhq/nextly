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

import { CardTierContext } from "../../frame/tier";
import { timeseriesBody } from "../timeseries";

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

function drawAt(tier: SizeTier) {
  const outcome = timeseriesBody(result, widget);
  if (!outcome.ok || !("node" in outcome) || !outcome.node) {
    throw new Error("the chart drew nothing");
  }
  render(
    <CardTierContext.Provider value={tier}>
      {outcome.node}
    </CardTierContext.Provider>
  );
}

const dates = () =>
  screen.queryByTestId("timeseries-dates")?.children.length ?? 0;

describe("an over-time card at each tier", () => {
  it("is the latest value and the range's total at small, with no dates under the line", () => {
    drawAt("small");
    const summary = screen.getByTestId("timeseries-summary");
    expect(summary).toHaveTextContent("4 latest");
    expect(summary).toHaveTextContent("45 in total");
    expect(dates()).toBe(0);
  });

  it("dates the line's two ends at medium", () => {
    drawAt("medium");
    expect(dates()).toBe(2);
    expect(screen.queryByTestId("timeseries-summary")).not.toBeInTheDocument();
  });

  it("adds dates between the ends at large", () => {
    drawAt("large");
    // 🔴 More than the two ends, and never every point: nine dates would crowd the axis.
    expect(dates()).toBeGreaterThan(2);
    expect(dates()).toBeLessThan(counts.length);
  });
});
