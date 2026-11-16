/**
 * A card lays itself out by its OWN rendered width, never the window's.
 *
 * Three copies of one list card in one viewport, in containers 300, 500 and 800 px wide: the
 * narrow one is small and the middle one medium, each a list whose rows carry their line of
 * detail, the wide one large, a table. One window, three layouts: only the card's width decides,
 * and it decides the layout alone, never how many rows: each draws every row its answer holds.
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
        <TieredRows items={items} columns={columns} labelField="title" />
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
    const tierOf = (at: number) =>
      screen
        .getByTestId(`at-${at}`)
        .querySelector("[data-tier]")
        ?.getAttribute("data-tier");
    expect([tierOf(300), tierOf(500), tierOf(800)]).toEqual([
      "small",
      "medium",
      "large",
    ]);

    expect(narrow.queryByTestId("list-card-table")).not.toBeInTheDocument();
    expect(middle.queryByTestId("list-card-table")).not.toBeInTheDocument();
    expect(wide.getByTestId("list-card-table")).toBeInTheDocument();
    expect(wide.queryByTestId("list-card-rows")).not.toBeInTheDocument();
  });

  it("draws every row its answer holds at every width", () => {
    // 🔴 Counted by the tier, the narrow card drew three and the others five.
    const { narrow, middle, wide } = drawThree();
    expect(narrow.getAllByTestId("entity-row")).toHaveLength(items.length);
    expect(middle.getAllByTestId("entity-row")).toHaveLength(items.length);
    expect(wide.getAllByTestId("list-card-table-row")).toHaveLength(
      items.length
    );
  });

  it("keeps each row's detail when small, as when medium", () => {
    // Below large every card stacks the row's slots, so a narrow card says what a row says.
    const { narrow, middle } = drawThree();
    expect(narrow.getAllByText("draft")).toHaveLength(items.length);
    expect(middle.getAllByText("draft")).toHaveLength(items.length);
  });
});
