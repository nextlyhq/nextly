/**
 * A card lays itself out by its OWN rendered width, never the window's.
 *
 * Three copies of one list card in one viewport, in containers 300, 500 and 800 px wide: the
 * narrow one is small (three rows, titles only), the middle one medium (its number of items),
 * the wide one large (a table). One window, three layouts: only the card's width decides.
 */
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TieredRows } from "../archetypes/tiered-rows";
import { WidgetCard } from "../WidgetCard";

const items = Array.from({ length: 8 }, (_, i) => ({
  title: `Post ${i + 1}`,
  status: "draft",
}));
const columns = [
  { name: "title", label: "Title" },
  { name: "status", label: "Status" },
];
const query = {
  source: "collection:posts",
  op: "list" as const,
  select: ["title", "status"],
  limit: 5,
};

beforeEach(() => {
  // jsdom lays nothing out: a card measures the width its test container states.
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const stated = this.parentElement?.dataset.width;
      if (stated === undefined) return original.call(this);
      const width = Number(stated);
      return {
        width,
        height: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    }
  );
});

afterEach(() => vi.restoreAllMocks());

function cardAt(width: number) {
  return (
    <div data-width={width} data-testid={`at-${width}`}>
      <WidgetCard title="Recent posts">
        <TieredRows
          items={items}
          columns={columns}
          labelField="title"
          detailField="status"
          query={query}
        />
      </WidgetCard>
    </div>
  );
}

describe("one card at three widths in one viewport", () => {
  it("is small, medium and large by its own width", () => {
    render(
      <>
        {cardAt(300)}
        {cardAt(500)}
        {cardAt(800)}
      </>
    );

    const narrow = within(screen.getByTestId("at-300"));
    const middle = within(screen.getByTestId("at-500"));
    const wide = within(screen.getByTestId("at-800"));

    expect(narrow.getAllByTestId("widget-list-row")).toHaveLength(3);
    expect(narrow.queryByText("draft")).not.toBeInTheDocument();

    expect(middle.getAllByTestId("widget-list-row")).toHaveLength(5);
    expect(middle.getAllByText("draft")).toHaveLength(5);

    expect(wide.getByTestId("widget-table")).toBeInTheDocument();
    expect(wide.queryByTestId("widget-list")).not.toBeInTheDocument();
  });
});
