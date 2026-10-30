/**
 * The Breakdown card, drawn from the data its `load` answers: one bar per group, named by the
 * grouped field's own value labels; the groups' empty state, worded for a read that stopped at
 * its bound; "not available" for a collection with nothing to divide by; and "View as table"
 * under the chart, opening a table of the same values in its place, which Escape closes, handing
 * focus back to the button.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { BreakdownWidgetData } from "nextly/core-widget-data";
import { fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen } from "@admin/__tests__/utils";

import { sizeChartsInTests } from "../widgets/charts/__tests__/chart-env";
import { CardTierContext } from "../widgets/frame/tier";

import { BreakdownCard } from "./BreakdownCard";

sizeChartsInTests();

const DATA: BreakdownWidgetData = {
  buckets: [
    { value: "published", count: 7 },
    { value: "draft", count: 3 },
    { value: null, count: 1 },
  ],
  field: {
    name: "status",
    label: "Status",
    choices: [
      { value: "published", label: "Published" },
      { value: "draft", label: "Draft" },
    ],
  },
};

function drawAt(tier: SizeTier, data: BreakdownWidgetData = DATA) {
  render(
    <CardTierContext.Provider value={tier}>
      {inFrame(
        <BreakdownCard
          widgetId="core/breakdown"
          placementId="p1"
          settings={{ collection: "posts" }}
          size={{ w: 4, h: 3, tier }}
          data={data}
          refreshing={false}
          retry={() => undefined}
        />
      )}
    </CardTierContext.Provider>
  );
}

/** The visible table's rows, each as its cells' text, below its heading row. */
function tableRows(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map(row =>
      within(row)
        .getAllByRole("cell")
        .map(cell => cell.textContent ?? "")
    );
}

describe("the Breakdown card", () => {
  it("names each group by its field's own value label, in the chart's own table", () => {
    drawAt("medium");
    const hidden = screen.getByTestId("chart-table");
    expect(within(hidden).getByText("Published")).toBeInTheDocument();
    expect(within(hidden).getByText("Draft")).toBeInTheDocument();
  });

  it("is not available for a collection with nothing to divide by", () => {
    drawAt("medium", { buckets: null });
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
  });

  it("says nothing matches yet when the read found no group", () => {
    drawAt("medium", { buckets: [] });
    expect(screen.getByText("Nothing to compare yet")).toBeInTheDocument();
  });

  it("says it found none in what it checked when its read stopped at its bound", () => {
    drawAt("medium", { buckets: [], atLeast: true });
    expect(
      screen.getByText("None found in what was checked")
    ).toBeInTheDocument();
  });

  it("opens a table of the same groups in the chart's place from View as table, and closes it on Escape", () => {
    drawAt("large");
    const button = screen.getByRole("button", { name: "View as table" });
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const table = screen.getByTestId("chart-disclosed-table");
    expect(button).toHaveAttribute("aria-controls", table.id);
    // The chart, and its own hidden table with it, give way to the visible one.
    expect(screen.queryByTestId("chart-table")).toBeNull();
    expect(tableRows(table).map(cells => cells.at(-1))).toEqual([
      "7",
      "3",
      "1",
    ]);
    expect(within(table).getByText("Published")).toBeInTheDocument();

    button.focus();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("chart-disclosed-table")).toBeNull();
    expect(screen.getByTestId("chart-table")).toBeInTheDocument();
    expect(document.activeElement).toBe(button);
  });

  it("writes each count as a floor in the table where the chart does", () => {
    drawAt("large", { ...DATA, atLeast: true });
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    const table = screen.getByTestId("chart-disclosed-table");
    expect(tableRows(table)[0]?.at(-1)).toMatch(/^7\+/);
  });
});
