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

const widget = (select?: string[]): DashboardWidget =>
  ({
    id: "acme/posts",
    title: "Recent posts",
    archetype: "table",
    size: "lg",
    query: {
      source: "collection:posts",
      op: "list",
      ...(select && { select }),
    },
  }) as DashboardWidget;

const listOf = (
  items: Record<string, unknown>[],
  fields?: { name: string; label?: string }[]
): WidgetResult => ({ op: "list", items, ...(fields && { fields }) });

function draw(result: WidgetResult, definition: DashboardWidget) {
  const outcome = tableBody(result, definition);
  if (!outcome.ok) throw new Error(`expected a body, got: ${outcome.message}`);
  render(<>{outcome.node}</>);
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

  it("falls back to the field name when the source has no label", () => {
    // A field name is a poor heading, but it is true — which an invented one
    // derived from the identifier would not be.
    draw(listOf([{ slug: "hello" }], [{ name: "slug" }]), widget(["slug"]));
    expect(screen.getByText("slug")).toBeInTheDocument();
  });

  it("draws only the columns the SERVER described, not those selected", () => {
    // The access case. `select` asked for two fields; the server answered with
    // one, because the other carries a read rule denying this caller. Heading
    // the table from the declaration would print "Salary" above a column every
    // row leaves empty.
    draw(
      listOf([{ title: "Hello" }], [{ name: "title", label: "Title" }]),
      widget(["title", "salary"])
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.queryByText(/salary/i)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("widget-table-heading")).toHaveLength(1);
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
    expect(screen.getByTestId("widget-table-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-table")).not.toBeInTheDocument();
  });

  it("caps the rows it draws", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `Row ${i}` }));
    draw(listOf(many, [{ name: "title" }]), widget(["title"]));
    expect(screen.getAllByTestId("widget-table-row")).toHaveLength(5);
  });

  it("does NOT stringify an object cell into [object Object]", () => {
    draw(
      listOf([{ title: { en: "Localised" } }], [{ name: "title" }]),
      widget(["title"])
    );
    expect(screen.queryByText(/object Object/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("widget-table-row")).toHaveLength(1);
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
