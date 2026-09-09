/**
 * What a `bars` card shows, and what it says to a reader who cannot see it.
 *
 * The lengths themselves are not asserted here — jsdom performs no layout, so a
 * bar's rendered width is not observable and `chart-scale.test.ts` asks that
 * question of the arithmetic directly. What IS observable, and what these cover,
 * is everything a chart can get wrong without being visibly broken: refusing the
 * wrong payload, naming a null bucket, disclosing a cap, and carrying a text
 * alternative and a real table.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetResult,
} from "@admin/types/dashboard/widgets";

import { barsAccepts, barsBody } from "../bars";

const widget = (): DashboardWidget =>
  ({
    id: "acme/by-status",
    title: "Entries by status",
    archetype: "bars",
    size: "md",
    query: { source: "collection:posts", op: "groupBy", groupBy: "status" },
  }) as DashboardWidget;

const grouped = (
  buckets: { value: string | null; count: number }[],
  truncated?: boolean
): WidgetResult => ({
  op: "groupBy",
  buckets,
  ...(truncated && { truncated }),
});

function draw(result: WidgetResult, definition = widget()) {
  const outcome = barsBody(result, definition);
  if (!outcome.ok) throw new Error(`expected a body, got: ${outcome.message}`);
  render(<>{outcome.node}</>);
}

describe("the bars archetype", () => {
  it("refuses a payload that is not grouped buckets", () => {
    // A count carries a single number, and the tempting coercion -- drawing one
    // bar of it -- invents a comparison the query never asked for.
    const outcome = barsBody({ op: "count", total: 12 }, widget());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("count");
  });

  it("needs a query, and says so by name", () => {
    expect(barsAccepts({ archetype: "bars", title: "By status" })).toContain(
      "By status"
    );
    expect(
      barsAccepts({ archetype: "bars", query: { op: "groupBy" } })
    ).toBeUndefined();
  });

  it("names the bucket for rows whose value is null", () => {
    // A null bucket is a real answer -- "how many entries have no author" -- and
    // an empty label would read as a rendering fault rather than as a group.
    draw(grouped([{ value: null, count: 4 }]));
    expect(screen.getAllByText("(none)").length).toBeGreaterThan(0);
  });

  it("carries a text alternative naming the largest bucket", () => {
    // What a screen reader is given INSTEAD of the shapes. Without it the card
    // announces a title and then a run of unlabelled elements.
    draw(
      grouped([
        { value: "Published", count: 128 },
        { value: "Draft", count: 57 },
      ])
    );
    const graphic = screen.getByRole("img");
    expect(graphic).toHaveAccessibleName(/Entries by status/);
    expect(graphic).toHaveAccessibleDescription(/Largest: Published, 128/);
  });

  it("puts every bucket in a real table, with the count beside it", () => {
    draw(
      grouped([
        { value: "Published", count: 128 },
        { value: "Draft", count: 57 },
      ])
    );
    const table = screen.getByRole("table");
    // Addressed by ROW rather than by a bare text match: a count that rendered
    // against the wrong label would satisfy two independent `getByText` calls
    // while telling the reader the opposite of the truth.
    const row = within(table).getByRole("row", { name: /Draft/ });
    expect(within(row).getByText("57")).toBeInTheDocument();
  });

  it("discloses a cap rather than quietly showing a partial picture", () => {
    draw(grouped([{ value: "Published", count: 9 }], true));
    expect(screen.getByText(/some are not listed/i)).toBeInTheDocument();
  });

  it("says nothing was matched rather than drawing an empty frame", () => {
    draw(grouped([]));
    expect(screen.getByText(/no rows matched/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
