/**
 * The Count card at each width, drawn from the data its `load` answers: the
 * number alone when small, the published and draft split when medium, the
 * trend and its change when large, each part only where its data is there,
 * and "not available" for a card set to no collection.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { CountWidgetData } from "nextly/core-widget-data";
import { describe, expect, it } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { fireEvent, render, screen, within } from "@admin/__tests__/utils";

import { CardTierContext } from "../widgets/frame/tier";

import { CountCard } from "./CountCard";

const DATA: CountWidgetData = {
  total: 10,
  split: { published: 7, draft: 3 },
  trend: {
    points: [
      { start: "2026-10-21T00:00:00.000Z", count: 2 },
      { start: "2026-10-22T00:00:00.000Z", count: 5 },
    ],
    prior: 4,
  },
};

function drawAt(
  tier: SizeTier,
  data: CountWidgetData,
  settings: Record<string, unknown> = { collection: "posts" }
) {
  render(
    <CardTierContext.Provider value={tier}>
      {inFrame(
        <CountCard
          widgetId="core/count"
          placementId="core/count:posts"
          settings={settings}
          size={{ w: 4, h: 2, tier }}
          data={data}
          refreshing={false}
          retry={() => undefined}
        />
      )}
    </CardTierContext.Provider>
  );
}

describe("the Count card", () => {
  it("is the number alone when small", () => {
    drawAt("small", DATA);
    expect(screen.getByLabelText("Entries in posts: 10")).toBeInTheDocument();
    expect(screen.queryByTestId("count-split")).not.toBeInTheDocument();
    expect(screen.queryByTestId("count-trend")).not.toBeInTheDocument();
  });

  it("adds the split when medium, each part linking to its list", () => {
    drawAt("medium", DATA);
    expect(screen.getByLabelText("Published: 7")).toHaveAttribute(
      "href",
      "/admin/collections/posts?status=published"
    );
    expect(screen.getByLabelText("Draft: 3")).toBeInTheDocument();
    expect(screen.queryByTestId("count-trend")).not.toBeInTheDocument();
  });

  it("adds what scheduled releases will publish when medium", () => {
    drawAt("medium", { ...DATA, scheduled: 2 });
    expect(
      screen.getByRole("link", { name: "Scheduled: 2" })
    ).toBeInTheDocument();
  });

  it("leaves the scheduled row out when its load left the figure out", () => {
    drawAt("medium", DATA);
    expect(screen.queryByText("Scheduled")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Draft: 3" })).toBeInTheDocument();
  });

  it("adds the trend and its change when large", () => {
    drawAt("large", DATA);
    expect(screen.getByTestId("count-trend")).toHaveTextContent(
      "7 created in the last 30 days, 3 more than the 30 before."
    );
  });

  it("offers the trend's days as a table from View as table, and closes it on Escape", () => {
    drawAt("large", DATA);
    const trend = screen.getByTestId("count-trend");
    const button = within(trend).getByRole("button", { name: "View as table" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    const table = within(trend).getByTestId("chart-disclosed-table");
    // One row a day, each with the count the chart draws for it.
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map(row =>
          within(row)
            .getAllByRole("cell")
            .map(cell => cell.textContent)
        )
    ).toEqual([
      ["Oct 21", "2"],
      ["Oct 22", "5"],
    ]);
    button.focus();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(within(trend).queryByTestId("chart-disclosed-table")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("draws the number at the large tier without a trend its data does not hold", () => {
    drawAt("large", { total: DATA.total, split: DATA.split });
    expect(screen.getByLabelText("Entries in posts: 10")).toBeInTheDocument();
    expect(screen.queryByTestId("count-trend")).not.toBeInTheDocument();
  });

  it("says it is not available when it is set to no collection", () => {
    drawAt("medium", DATA, {});
    expect(screen.getByTestId("card-unavailable")).toBeInTheDocument();
  });
});
