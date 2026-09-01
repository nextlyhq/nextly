/**
 * What a `list` card shows, and what it refuses to guess at.
 *
 * Asserted through the body rather than the whole grid, because the decisions
 * here are about ONE payload and one declaration — which field is the label,
 * what a non-printable cell becomes, what an empty result reads as.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetResult,
} from "@admin/types/dashboard/widgets";

import { listBody } from "../list";

const widget = (select?: string[]): DashboardWidget =>
  ({
    id: "acme/recent",
    title: "Recent posts",
    archetype: "list",
    size: "md",
    query: {
      source: "collection:posts",
      op: "list",
      ...(select && { select }),
    },
  }) as DashboardWidget;

const listOf = (items: Record<string, unknown>[]): WidgetResult => ({
  op: "list",
  items,
});

/** Renders a successful body, or fails loudly with the refusal's message. */
function draw(result: WidgetResult, definition: DashboardWidget) {
  const outcome = listBody(result, definition);
  if (!outcome.ok) throw new Error(`expected a body, got: ${outcome.message}`);
  render(<>{outcome.node}</>);
}

describe("the list archetype", () => {
  it("takes the row's label from the FIRST selected field", () => {
    draw(
      listOf([{ title: "Hello", slug: "hello" }]),
      widget(["title", "slug"])
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("shows the second selected field as the line under it", () => {
    draw(
      listOf([{ title: "Hello", slug: "hello" }]),
      widget(["title", "slug"])
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("ignores fields past the second", () => {
    // Two lines is the card's whole vocabulary. A third would either wrap into
    // the next row or silently truncate, and neither reads as a list.
    draw(listOf([{ a: "one", b: "two", c: "three" }]), widget(["a", "b", "c"]));
    expect(screen.queryByText("three")).not.toBeInTheDocument();
  });

  it("refuses a list whose query selects nothing, by name", () => {
    // Without `select` the rows carry whatever the collection holds, so core
    // would be picking a key out of a document it knows nothing about — and the
    // key it picked would change the day someone added a column.
    const outcome = listBody(listOf([{ title: "Hello" }]), widget());
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toMatch(/Recent posts/);
    expect(outcome.ok === false && outcome.message).toMatch(
      /selects no fields/i
    );
  });

  it("refuses a count payload, naming both ops", () => {
    const outcome = listBody({ op: "count", total: 3 }, widget(["title"]));
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toMatch(/expected a list/i);
    expect(outcome.ok === false && outcome.message).toMatch(/count/);
  });

  it("says nothing is there rather than drawing an empty list", () => {
    draw(listOf([]), widget(["title"]));
    expect(screen.getByTestId("widget-list-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-list-row")).not.toBeInTheDocument();
  });

  it("caps the rows it draws", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `Row ${i}` }));
    draw(listOf(many), widget(["title"]));
    expect(screen.getAllByTestId("widget-list-row")).toHaveLength(5);
  });

  it("does NOT stringify an object cell into [object Object]", () => {
    // The exact defect a sibling widget shipped once: a relationship, repeater
    // or rich-text value arrives as an object, and `String(value)` renders
    // "[object Object]" — which looks like data rather than a bug.
    draw(
      listOf([{ title: { en: "Localised" }, slug: "x" }]),
      widget(["title", "slug"])
    );
    expect(screen.queryByText(/object Object/)).not.toBeInTheDocument();
    // The row still occupies its place, so the count matches the result.
    expect(screen.getAllByTestId("widget-list-row")).toHaveLength(1);
  });

  it("prints a zero rather than dropping it", () => {
    // `0` and `false` are answers; only null/undefined/blank are absences.
    draw(listOf([{ views: 0 }]), widget(["views"]));
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("leaves the second line off when that field is absent", () => {
    draw(listOf([{ title: "Hello" }]), widget(["title", "slug"]));
    const row = screen.getByTestId("widget-list-row");
    expect(row.textContent).toBe("Hello");
  });
});
