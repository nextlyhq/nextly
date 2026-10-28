/**
 * A card lays itself out by its OWN rendered width, never the window's.
 *
 * Three copies of one list card in one viewport, in containers 300, 500 and 800 px wide: the
 * narrow one is small (three rows, titles only), the middle one medium (five rows, each with its
 * line of detail), the wide one large (a table of ten). One window, three layouts: only the
 * card's width decides.
 */
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TieredRows } from "../archetypes/tiered-rows";
import { WidgetCard } from "../WidgetCard";

const items = Array.from({ length: 11 }, (_, i) => ({
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
  limit: 10,
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
          query={query}
        />
      </WidgetCard>
    </div>
  );
}

/** The three cards, each queried within its own container. */
function drawThree() {
  render(
    <>
      {cardAt(300)}
      {cardAt(500)}
      {cardAt(800)}
    </>
  );
  return {
    narrow: within(screen.getByTestId("at-300")),
    middle: within(screen.getByTestId("at-500")),
    wide: within(screen.getByTestId("at-800")),
  };
}

describe("one card at three widths in one viewport", () => {
  it("is small, medium and large by its own width", () => {
    const { narrow, middle, wide } = drawThree();

    expect(narrow.getAllByTestId("entity-row")).toHaveLength(3);

    expect(middle.getAllByTestId("entity-row")).toHaveLength(5);
    expect(middle.getAllByText("draft")).toHaveLength(5);

    expect(wide.getByTestId("list-card-table")).toBeInTheDocument();
    expect(wide.getAllByTestId("list-card-table-row")).toHaveLength(10);
    expect(wide.queryByTestId("list-card-rows")).not.toBeInTheDocument();
  });

  it("keeps each row's detail when small, in fewer rows", () => {
    // Below large every card stacks the row's slots; the narrow card differs in how many
    // rows it draws, not in what a row says.
    const { narrow } = drawThree();
    expect(narrow.getAllByText("draft")).toHaveLength(3);
  });
});
