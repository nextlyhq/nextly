/**
 * The Over time card, drawn from the data its `load` answers: every interval its range overlaps,
 * drawn as a line or, when its Chart style asks, as bars; the latest value and the range's total
 * above it when small; and "View as table" under the chart, opening a table of the same values
 * in its place, which Escape closes, handing focus back to the button.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { OverTimeWidgetData } from "nextly/core-widget-data";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen } from "@admin/__tests__/utils";

import { sizeChartsInTests } from "../widgets/charts/__tests__/chart-env";
import { CardTierContext } from "../widgets/frame/tier";

import { OverTimeCard } from "./OverTimeCard";

const DATA: OverTimeWidgetData = {
  interval: "day",
  points: [
    { start: "2026-10-20T00:00:00.000Z", count: 0 },
    { start: "2026-10-21T00:00:00.000Z", count: 2 },
    { start: "2026-10-22T00:00:00.000Z", count: 5 },
  ],
};

sizeChartsInTests();

/** Draws the card at `tier`, and waits for its chart's drawing, which loads lazily. */
async function drawAt(
  tier: SizeTier,
  chartStyle?: string,
  data: OverTimeWidgetData = DATA
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
          size={{ w: 6, h: 3, tier }}
          data={data}
          refreshing={false}
          retry={() => undefined}
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
      interval: "week",
      points: [
        { start: "2026-10-12T00:00:00.000Z", count: 0 },
        { start: "2026-10-19T00:00:00.000Z", count: 0 },
      ],
    });
    // A line along zero through both intervals, not an empty box.
    expect(
      drawing.querySelector(".recharts-area-curve")?.getAttribute("d")
    ).toMatch(/^M[\d.]+,[\d.]+L[\d.]+,[\d.]+$/);
  });

  it("opens a table of the same values in the chart's place from View as table, and closes it on Escape", async () => {
    await drawAt("large");
    const button = screen.getByRole("button", { name: "View as table" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("chart-disclosed-table")).toBeNull();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const table = screen.getByTestId("chart-disclosed-table");
    expect(button).toHaveAttribute("aria-controls", table.id);
    // The chart gives way to the table, which is a real table on a large card.
    expect(screen.queryByTestId("chart-drawing")).toBeNull();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      rows.map(row =>
        within(row)
          .getAllByRole("cell")
          .map(cell => cell.textContent)
      )
    ).toEqual([
      ["Oct 20", "0"],
      ["Oct 21", "2"],
      ["Oct 22", "5"],
    ]);
    // Headed as the chart's own table heads its columns.
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map(heading => heading.textContent)
    ).toEqual(["Interval", "Count"]);

    button.focus();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("chart-disclosed-table")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("returns focus to the button when Escape is pressed inside the open table", async () => {
    await drawAt("large");
    const button = screen.getByRole("button", { name: "View as table" });
    fireEvent.click(button);
    const table = screen.getByTestId("chart-disclosed-table");
    // Focus moved into the table, as a reader tabbing on would take it.
    table.tabIndex = -1;
    table.focus();
    fireEvent.keyDown(table, { key: "Escape" });
    expect(screen.queryByTestId("chart-disclosed-table")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
