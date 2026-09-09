/**
 * What a `timeseries` card shows, and which instant each point is called.
 *
 * The labelling is the part with a real defect in it. The server buckets in
 * UTC, so a point IS a UTC calendar day; rendering that instant in another zone
 * renames the bucket, and the axis would then disagree with both the table
 * beside it and the server that produced it.
 */
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { setGlobalDateTimeConfig } from "@admin/lib/dates/format";
import type {
  DashboardWidget,
  WidgetResult,
} from "@admin/types/dashboard/widgets";

import { timeseriesAccepts, timeseriesBody } from "../timeseries";

const widget = (): DashboardWidget =>
  ({
    id: "acme/over-time",
    title: "Entries over time",
    archetype: "timeseries",
    size: "lg",
    query: {
      source: "collection:posts",
      op: "timeseries",
      dateField: "createdAt",
      interval: "day",
    },
  }) as DashboardWidget;

const series = (
  points: { start: string; count: number }[],
  interval = "day"
): WidgetResult =>
  ({ op: "timeseries", points, interval }) as unknown as WidgetResult;

function draw(result: WidgetResult, definition = widget()) {
  const outcome = timeseriesBody(result, definition);
  if (!outcome.ok) throw new Error(`expected a body, got: ${outcome.message}`);
  render(<>{outcome.node}</>);
}

afterEach(() => {
  setGlobalDateTimeConfig({});
});

describe("the timeseries archetype", () => {
  it("refuses a payload that is not a timeline", () => {
    const outcome = timeseriesBody(
      { op: "groupBy", buckets: [{ value: "a", count: 1 }] },
      widget()
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("groupBy");
  });

  it("needs a query, and says so by name", () => {
    expect(
      timeseriesAccepts({ archetype: "timeseries", title: "Over time" })
    ).toContain("Over time");
    expect(
      timeseriesAccepts({
        archetype: "timeseries",
        query: { op: "timeseries" },
      })
    ).toBeUndefined();
  });

  it("labels a bucket by its UTC date whatever zone the install is set to", () => {
    // The defect this exists for: a UTC day begins at midnight, which is 19:00
    // the PREVIOUS day at UTC-5. Formatted in the install's zone, March 4th's
    // rows would be labelled "Mar 3" while the server and the table call them
    // the 4th.
    setGlobalDateTimeConfig({ timezone: "America/New_York", locale: "en-US" });
    draw(series([{ start: "2026-03-04T00:00:00.000Z", count: 3 }]));

    const table = screen.getByRole("table");
    expect(within(table).getByText(/Mar 4/)).toBeInTheDocument();
    expect(within(table).queryByText(/Mar 3/)).not.toBeInTheDocument();
  });

  it("still honours the install's locale for how that date is written", () => {
    // The zone is pinned; the FORMAT is not. Pinning both would make these
    // cards the only dates in the admin that ignore the configured preference.
    setGlobalDateTimeConfig({ timezone: "UTC", locale: "de-DE" });
    draw(series([{ start: "2026-03-04T00:00:00.000Z", count: 3 }]));

    const table = screen.getByRole("table");
    // German abbreviates March as "Mär"; the assertion is that the locale
    // reached the formatter at all, not the exact spelling.
    expect(within(table).queryByText(/Mar 4/)).not.toBeInTheDocument();
  });

  it("carries a text alternative naming the busiest interval and the total", () => {
    draw(
      series([
        { start: "2026-03-04T00:00:00.000Z", count: 2 },
        { start: "2026-03-05T00:00:00.000Z", count: 9 },
      ])
    );
    const graphic = screen.getByRole("img");
    expect(graphic).toHaveAccessibleName(/Entries over time/);
    expect(graphic).toHaveAccessibleDescription(/11 in total/);
    expect(graphic).toHaveAccessibleDescription(/Busiest/);
  });

  it("keeps an empty interval as a zero row rather than dropping it", () => {
    // Zero means NO ROWS, never unknown -- the whole window was read. A missing
    // row would let a reader infer the interval was not measured.
    draw(
      series([
        { start: "2026-03-04T00:00:00.000Z", count: 0 },
        { start: "2026-03-05T00:00:00.000Z", count: 4 },
      ])
    );
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2
    expect(within(table).getByText("0")).toBeInTheDocument();
  });

  it("marks a single interval instead of drawing an invisible line", () => {
    // One point is a legal window and produces no line segment, so without a
    // marker the card renders an empty box that reads as a failure.
    const { container } = render(
      <>
        {(() => {
          const outcome = timeseriesBody(
            series([{ start: "2026-03-04T00:00:00.000Z", count: 5 }]),
            widget()
          );
          if (!outcome.ok) throw new Error(outcome.message);
          return outcome.node;
        })()}
      </>
    );
    expect(container.querySelector("circle")).not.toBeNull();
  });

  it("says the window is empty rather than drawing nothing at all", () => {
    draw(series([]));
    expect(screen.getByText(/no intervals/i)).toBeInTheDocument();
  });
});
