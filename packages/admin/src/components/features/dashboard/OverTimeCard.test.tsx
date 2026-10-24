/**
 * The Over time card: every interval its range overlaps, drawn as a line or, when its Chart style
 * asks, as bars; the latest value and the range's total above it when small.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetSlot } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { CardTierContext } from "../widgets/frame/tier";

import { OverTimeCard } from "./OverTimeCard";

const SLOT: WidgetSlot = {
  ok: true,
  result: {
    op: "timeseries",
    interval: "day",
    points: [
      { start: "2026-10-20T00:00:00.000Z", count: 0 },
      { start: "2026-10-21T00:00:00.000Z", count: 2 },
      { start: "2026-10-22T00:00:00.000Z", count: 5 },
    ],
  },
};

function drawAt(tier: SizeTier, chartStyle?: string, slot: WidgetSlot = SLOT) {
  render(
    <CardTierContext.Provider value={tier}>
      <OverTimeCard
        widgetId="core/over-time"
        placementId="p1"
        settings={{
          collection: "posts",
          dateRange: "30d",
          ...(chartStyle ? { chartStyle } : {}),
        }}
        slot={slot}
        isFetching={false}
      />
    </CardTierContext.Provider>
  );
}

describe("the Over time card", () => {
  it("states the latest value and the range's total when small", () => {
    drawAt("small");
    expect(screen.getByTestId("timeseries-summary")).toHaveTextContent(
      /5\s*latest.*7\s*in total/s
    );
  });

  it("draws a line by default, and bars when its Chart style asks", () => {
    drawAt("medium");
    expect(screen.getByTestId("chart-series")).not.toHaveAttribute(
      "data-chart-style"
    );
    drawAt("medium", "bars");
    expect(
      screen
        .getAllByTestId("chart-series")
        .some(series => series.getAttribute("data-chart-style") === "bars")
    ).toBe(true);
  });

  it("draws a range with no entries as its intervals at zero, not as nothing", () => {
    // 🔴 An empty interval counts as zero: a range with no entries still has
    // its intervals to draw.
    drawAt("medium", undefined, {
      ok: true,
      result: {
        op: "timeseries",
        interval: "week",
        points: [
          { start: "2026-10-12T00:00:00.000Z", count: 0 },
          { start: "2026-10-19T00:00:00.000Z", count: 0 },
        ],
      },
    });
    expect(screen.getByTestId("chart-series")).toBeInTheDocument();
  });
});
