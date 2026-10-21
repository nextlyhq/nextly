/**
 * The pointer's drag, read against the grid as it stood at pick-up.
 *
 * jsdom lays nothing out, so the grid and its cells are given their rectangles here, and the
 * page "scrolls" by moving them. dnd-kit's move event is handed in as dnd-kit builds it: the
 * pointer's position at pick-up, and a delta that already counts any scrolling since.
 */
import type { DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { drawnSpan } from "../../../sizes";
import type { ArrangedWidget } from "../../useDashboardArrangement";
import { finalPositionAt, type DrawnCard } from "../drop-geometry";
import { CELL_PLACEMENT_ATTRIBUTE, useCardDrag } from "../useCardDrag";

const WIDTH = 1200;
const HEIGHT = 100;
const IDS = ["p1", "p2", "p3"];

/** A grid of three full-width cards, one under another, whose top `scrolled` moves up the page. */
function stubGrid(position: { scrolled: number }): HTMLElement {
  const grid = document.createElement("section");
  const rect = (top: number, height: number) =>
    ({
      left: 0,
      top,
      right: WIDTH,
      bottom: top + height,
      width: WIDTH,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  grid.getBoundingClientRect = () =>
    rect(-position.scrolled, HEIGHT * IDS.length);
  IDS.forEach((id, index) => {
    const cell = document.createElement("div");
    cell.setAttribute(CELL_PLACEMENT_ATTRIBUTE, id);
    cell.getBoundingClientRect = () =>
      rect(index * HEIGHT - position.scrolled, HEIGHT);
    grid.append(cell);
  });
  return grid;
}

const rows = IDS.map(placementId => ({
  placementId,
  width: "full",
  allowedWidths: ["full"],
  widget: { title: placementId },
})) as unknown as ArrangedWidget[];

/** The cards as the drag measures them at pick-up: relative to the grid. */
const cards: DrawnCard[] = IDS.map((id, index) => ({
  id,
  span: drawnSpan("full", "wide"),
  rect: {
    left: 0,
    top: index * HEIGHT,
    right: WIDTH,
    bottom: (index + 1) * HEIGHT,
  },
}));

describe("a pointer drag over a page that scrolls", () => {
  it("counts the scrolling once, so the card lands where the pointer is", () => {
    const position = { scrolled: 0 };
    const grid = stubGrid(position);
    const { result } = renderHook(() =>
      useCardDrag({
        rows,
        band: "wide",
        width: WIDTH,
        gridRef: { current: grid },
        say: () => undefined,
        drop: () => undefined,
      })
    );

    act(() =>
      result.current.onDragStart({
        active: { id: "p1" },
      } as unknown as DragStartEvent)
    );
    // The page scrolls 100px under a pointer that has not moved on the screen: dnd-kit's
    // delta is that scrolling, and the grid's corner is now 100px higher.
    position.scrolled = 100;
    act(() =>
      result.current.onDragMove({
        activatorEvent: { clientX: 600, clientY: 50 },
        delta: { x: 0, y: 100 },
      } as unknown as DragMoveEvent)
    );

    // In the grid, the pointer is now 100px below where it started, over the second card.
    const aimed = finalPositionAt(cards, 0, { x: 600, y: 150 }, WIDTH);
    // 🔴 The slip: subtracting the grid's corner as it is now counts the scrolling again.
    const twice = finalPositionAt(cards, 0, { x: 600, y: 250 }, WIDTH);
    expect(aimed).not.toBe(twice);
    expect(result.current.drag?.final).toBe(aimed);
  });
});
