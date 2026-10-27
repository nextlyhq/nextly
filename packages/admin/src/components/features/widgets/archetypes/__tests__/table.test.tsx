/**
 * What a `table` card shows, and where its column headings come from.
 *
 * The headings are the point of this archetype's tests. They come from the
 * RESULT, because the server strips fields a reader may not see before it
 * answers — so a table headed from the declaration would name a column no row
 * can fill and print the label of a field this reader was denied.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetResult,
} from "@admin/types/dashboard/widgets";

import { tableAccepts, tableBody } from "../table";
import { CardEmpty } from "../../frame/states";
import { CardTierContext } from "../../frame/tier";
import { gridBounds } from "../../__tests__/grid-bounds";

const widget = (select?: string[], limit?: number): DashboardWidget =>
  ({
    id: "acme/posts",
    title: "Recent posts",
    archetype: "table",
    size: gridBounds(6),
    query: {
      source: "collection:posts",
      op: "list",
      ...(select && { select }),
      ...(limit !== undefined && { limit }),
    },
  }) as DashboardWidget;

const listOf = (
  items: Record<string, unknown>[],
  fields?: { name: string; label?: string }[]
): WidgetResult => ({ op: "list", items, ...(fields && { fields }) });

function draw(result: WidgetResult, definition: DashboardWidget) {
  const outcome = tableBody(result, definition);
  if (!outcome.ok) throw new Error(`expected a body, got: ${outcome.message}`);
  // At the large tier, where a table card is drawn as a table; below it, it is a list
  // (`list-tiers.test.tsx` covers that).
  render(
    <CardTierContext.Provider value="large">
      {outcome.empty ? <CardEmpty {...outcome.empty} /> : outcome.node}
    </CardTierContext.Provider>
  );
}

describe("the table archetype", () => {
  it("heads each column with the source's label", () => {
    draw(
      listOf(
        [{ title: "Hello", publishedAt: "yesterday" }],
        [
          { name: "title", label: "Title" },
          { name: "publishedAt", label: "Published at" },
        ]
      ),
      widget(["title", "publishedAt"])
    );
    expect(screen.getByText("Published at")).toBeInTheDocument();
    // The storage name is NOT what a reader sees when a label exists.
    expect(screen.queryByText("publishedAt")).not.toBeInTheDocument();
  });

  it("falls back to the field name, written as the admin writes any field's, when the source has no label", () => {
    // 🔴 The admin names a field one way on every surface (`lib/field-label`): the entry list
    // heads this column "Slug", so a card heading it "slug" names one field two ways.
    draw(
      listOf(
        [{ title: "Hello", slug: "hello" }],
        [{ name: "title", label: "Title" }, { name: "slug" }]
      ),
      widget(["title", "slug"])
    );
    expect(
      screen.getAllByRole("columnheader").map(node => node.textContent)
    ).toEqual(["Title", "Slug"]);
  });

  it("draws only the columns the SERVER described, not those selected", () => {
    // The access case. `select` asked for two fields; the server answered with
    // one, because the other carries a read rule denying this caller. Heading
    // the table from the declaration would print "Salary" above a column every
    // row leaves empty.
    draw(
      listOf(
        [{ title: "Hello", views: 3 }],
        [
          { name: "title", label: "Title" },
          { name: "views", label: "Views" },
        ]
      ),
      widget(["title", "salary", "views"])
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.queryByText(/salary/i)).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("columnheader").map(node => node.textContent)
    ).toEqual(["Title", "Views"]);
  });

  it("refuses rows the server did not describe rather than reading select", () => {
    // The tempting fallback is the one thing that must not happen: heading the
    // table from `query.select` would undo the server's access filtering.
    const outcome = tableBody(
      listOf([{ title: "Hello" }]),
      widget(["title", "salary"])
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toMatch(
      /did not describe/i
    );
  });

  it("refuses a count payload, naming both ops", () => {
    const outcome = tableBody({ op: "count", total: 3 }, widget(["title"]));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toMatch(
      /expected a table/i
    );
    expect(outcome.ok === false && outcome.message).toMatch(/count/);
  });

  it("says nothing is there rather than drawing an empty table", () => {
    draw(listOf([]), widget(["title"]));
    // The frame's one empty state, not a table of nothing.
    expect(screen.getByTestId("card-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("list-card-table")).not.toBeInTheDocument();
  });

  it("draws the card's number of items, five when it names none", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      title: `Row ${i}`,
      views: i,
    }));
    draw(
      listOf(many, [{ name: "title" }, { name: "views" }]),
      widget(["title", "views"])
    );
    expect(screen.getAllByTestId("list-card-table-row")).toHaveLength(5);
  });

  it("caps the rows it draws at ten, whatever the card asks for", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      title: `Row ${i}`,
      views: i,
    }));
    draw(
      listOf(many, [{ name: "title" }, { name: "views" }]),
      widget(["title", "views"], 25)
    );
    expect(screen.getAllByTestId("list-card-table-row")).toHaveLength(10);
  });

  it("does NOT stringify an object cell into [object Object]", () => {
    draw(
      listOf(
        [{ title: { en: "Localised" }, views: { total: 3 } }],
        [{ name: "title" }, { name: "views" }]
      ),
      widget(["title", "views"])
    );
    expect(screen.queryByText(/object Object/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("list-card-table-row")).toHaveLength(1);
  });

  it("prints a zero rather than dropping it", () => {
    draw(listOf([{ views: 0 }], [{ name: "views" }]), widget(["views"]));
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("refuses a declaration that selects nothing, before any query runs", () => {
    expect(tableAccepts(widget())).toMatch(/selects no fields/i);
    expect(tableAccepts(widget(["title"]))).toBeUndefined();
  });
});
