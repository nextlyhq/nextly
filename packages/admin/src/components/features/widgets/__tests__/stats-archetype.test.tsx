/**
 * The `stats` card: several numbers, drawn independently, each one a link.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { WidgetRenderer } from "../WidgetRenderer";

const count = (total: number): WidgetSlot => ({
  ok: true,
  result: { op: "count", total },
});

const card: DashboardWidget = {
  id: "collection/posts-stats",
  title: "posts health",
  archetype: "stats",
  size: "md",
  cells: [
    {
      key: "total",
      label: "Total",
      query: { source: "collection:posts", op: "count", status: "all" },
      link: { label: "All posts", href: "/admin/collections/posts" },
    },
    {
      key: "draft",
      label: "Draft",
      query: { source: "collection:posts", op: "count", status: "draft" },
      link: {
        label: "Draft posts",
        href: "/admin/collections/posts?where=%7B%22status%22%3A%7B%22equals%22%3A%22draft%22%7D%7D",
      },
    },
  ],
};

function renderWith(answers: Record<string, WidgetSlot | undefined>) {
  render(
    <WidgetRenderer
      definition={card}
      slot={undefined}
      slotFor={key => answers[key]}
    />
  );
}

describe("a stats card", () => {
  it("draws every declared number, with its label", () => {
    renderWith({ total: count(1204), draft: count(14) });

    expect(screen.getByText("1,204")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("keeps drawing the numbers that ARRIVED when one has not", async () => {
    // 🔴 The property that makes this a card rather than six cards. The value
    // of a health card is the comparison between its numbers, so one cell still
    // in flight must not blank the others -- a reader who can see one of two is
    // better served than one who sees an error box.
    renderWith({ total: count(1204), draft: undefined });

    expect(screen.getByText("1,204")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("14")).not.toBeInTheDocument();
  });

  it("keeps drawing when one cell FAILED", () => {
    renderWith({
      total: count(1204),
      draft: { ok: false, error: "nope" },
    });

    expect(screen.getByText("1,204")).toBeInTheDocument();
    // The failed cell says nothing rather than showing a number it does not
    // have; the card is still readable.
    expect(screen.queryByText("14")).not.toBeInTheDocument();
  });

  it("refuses to invent a number from a LIST result", () => {
    // 🔴 The refusal `metric` makes, per cell. `items.length` is capped by the
    // query's own limit, so coercing it would draw "5" for a collection of ten
    // thousand -- a number no reader could tell was wrong.
    renderWith({
      total: { ok: true, result: { op: "list", items: [{}, {}, {}] } },
      draft: count(14),
    });

    expect(screen.queryByText("3")).not.toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
  });

  it("makes each number a link named for where it goes", () => {
    // The number is the target, and the accessible name says what activating it
    // does -- "1,204" alone tells a screen-reader user nothing.
    renderWith({ total: count(1204), draft: count(14) });

    const drafts = screen.getByRole("link", { name: "Draft posts" });
    expect(drafts).toHaveAttribute("href", expect.stringContaining("where="));
    expect(screen.getByRole("link", { name: "All posts" })).toHaveAttribute(
      "href",
      "/admin/collections/posts"
    );
  });

  it("draws a card whose id contains the separator a composite key would use", () => {
    // 🔴 A contributed widget id is checked for being usable TEXT, not against
    // the registry's slug pattern, so it may contain any character. Under a
    // composite `${id}#${key}` slot key, this card's "b" cell and a widget
    // literally named `core/a#b` file into the same entry and one draws the
    // other's number. Nesting removes the encoding, so there is no string left
    // to collide.
    render(
      <WidgetRenderer
        definition={{
          ...card,
          id: "core/a#b",
          cells: [{ key: "b", label: "B", query: card.cells![0].query }],
        }}
        slot={undefined}
        slotFor={key => (key === "b" ? count(7) : undefined)}
      />
    );
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("says so when a stats widget declares no cells", () => {
    render(
      <WidgetRenderer
        definition={{ ...card, cells: [] }}
        slot={undefined}
        slotFor={() => undefined}
      />
    );
    expect(screen.getByText(/drawn from cells/i)).toBeInTheDocument();
  });
});
