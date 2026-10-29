/**
 * The Over time card: every interval its range overlaps, drawn as a line or, when its Chart style
 * asks, as bars; the latest value and the range's total above it when small.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { WidgetSlot } from "nextly/widget-result";
import { cleanup } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen } from "@admin/__tests__/utils";

import { sizeChartsInTests } from "../widgets/charts/__tests__/chart-env";
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

sizeChartsInTests();

/** Draws the card at `tier`, and waits for its chart's drawing, which loads lazily. */
async function drawAt(
  tier: SizeTier,
  chartStyle?: string,
  slot: WidgetSlot = SLOT
): Promise<HTMLElement> {
  render(
    <CardTierContext.Provider value={tier}>
      {inFrame(
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
      )}
    </CardTierContext.Provider>
  );
  return screen.findByTestId("chart-drawing");
}

describe("the Over time card", () => {
  it("states the latest value and the range's total when small", async () => {
    await drawAt("small");
    expect(screen.getByTestId("timeseries-summary")).toHaveTextContent(
      /5\s*latest.*7\s*in total/s
    );
  });

  it("draws a line by default, and bars when its Chart style asks", async () => {
    let drawing = await drawAt("medium");
    expect(drawing.querySelector(".recharts-area-curve")).not.toBeNull();
    expect(drawing.querySelector(".recharts-bar")).toBeNull();
    cleanup();
    drawing = await drawAt("medium", "bars");
    // One bar per interval with entries: the first interval's zero is no height to draw.
    expect(drawing.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(2);
    expect(drawing.querySelector(".recharts-area-curve")).toBeNull();
  });

  it("draws a range with no entries as its intervals at zero, not as nothing", async () => {
    // 🔴 An empty interval counts as zero: a range with no entries still has
    // its intervals to draw.
    const drawing = await drawAt("medium", undefined, {
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
    // A line along zero through both intervals, not an empty box.
    expect(
      drawing.querySelector(".recharts-area-curve")?.getAttribute("d")
    ).toMatch(/^M[\d.]+,[\d.]+L[\d.]+,[\d.]+$/);
  });
});
