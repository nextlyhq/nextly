/**
 * The pointer's drag: the order it reaches as the pointer moves, read against the grid as it
 * stood at pick-up, and how it ends.
 *
 * jsdom lays nothing out, so the grid and its cells are given their places here: each cell its
 * layout offsets within the grid, and the grid its corner on the screen, which the page
 * "scrolls" by moving. dnd-kit's move event is handed in as dnd-kit builds it: the pointer's
 * position at pick-up, and a delta that already counts any scrolling since.
 */
import type { DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { gridBounds } from "../../../__tests__/grid-bounds";
import type { ArrangedWidget } from "../../useDashboardArrangement";
import { CELL_PLACEMENT_ATTRIBUTE } from "../cell-placement";
import { dragMessages } from "../drag-messages";
import { useCardDrag } from "../useCardDrag";

const WIDTH = 1200;
const HEIGHT = 100;
const IDS = ["p1", "p2", "p3"];

/** A grid of three full-width cards, one under another, whose top `scrolled` moves up the page. */
function stubGrid(position: { scrolled: number }): HTMLElement {
  const grid = document.createElement("section");
  grid.getBoundingClientRect = () =>
    ({
      left: 0,
      top: -position.scrolled,
      right: WIDTH,
      bottom: HEIGHT * IDS.length - position.scrolled,
      width: WIDTH,
      height: HEIGHT * IDS.length,
      x: 0,
      y: -position.scrolled,
      toJSON: () => ({}),
    }) as DOMRect;
  IDS.forEach((id, index) => {
    const cell = document.createElement("div");
    cell.setAttribute(CELL_PLACEMENT_ATTRIBUTE, id);
    // Laid out within the grid, which scrolling does not change.
    for (const [name, value] of Object.entries({
      offsetParent: grid,
      offsetLeft: 0,
      offsetTop: index * HEIGHT,
      offsetWidth: WIDTH,
      offsetHeight: HEIGHT,
    })) {
      Object.defineProperty(cell, name, { value, configurable: true });
    }
    grid.append(cell);
  });
  return grid;
}

const rows = IDS.map(placementId => ({
  placementId,
  size: { w: 12, h: 2 },
  widget: { title: `Card ${placementId}`, size: gridBounds(12, 2) },
})) as unknown as ArrangedWidget[];

function renderDrag(position = { scrolled: 0 }, width = WIDTH) {
  const grid = stubGrid(position);
  const say = vi.fn();
  const drop = vi.fn();
  const flip = { capture: vi.fn() };
  const hook = renderHook(
    ({ at }: { at: number }) =>
      useCardDrag({
        rows,
        width: at,
        gridRef: { current: grid },
        flip,
        say,
        drop,
      }),
    { initialProps: { at: width } }
  );
  return { ...hook, say, drop, flip };
}

function start(
  result: ReturnType<typeof renderDrag>["result"],
  id: string
): void {
  act(() =>
    result.current.onDragStart({
      active: { id },
    } as unknown as DragStartEvent)
  );
}

/** The pointer at `y` on the screen at pick-up, moved `dy` since (scrolling included). */
function move(
  result: ReturnType<typeof renderDrag>["result"],
  y: number,
  dy: number
): void {
  act(() =>
    result.current.onDragMove({
      activatorEvent: { clientX: 600, clientY: y },
      delta: { x: 0, y: dy },
    } as unknown as DragMoveEvent)
  );
}

describe("a pointer drag", () => {
  it("draws the held card where the pointer would put it as the pointer moves, before any release", () => {
    const { result, flip } = renderDrag();
    start(result, "p1");
    expect(result.current.drag?.order).toEqual(["p1", "p2", "p3"]);

    // Into the second card's lower half: after it.
    move(result, 50, 130);
    expect(result.current.drag?.order).toEqual(["p2", "p1", "p3"]);
    // Every card's place was noted just before the change, so the others slide to theirs.
    expect(flip.capture).toHaveBeenCalledTimes(1);

    // On into the third card's lower half.
    move(result, 50, 230);
    expect(result.current.drag?.order).toEqual(["p2", "p3", "p1"]);
  });

  it("counts the page's scrolling once, so the card goes where the pointer is", () => {
    const position = { scrolled: 0 };
    const { result } = renderDrag(position);
    start(result, "p1");
    // The page scrolls 130px under a pointer that has not moved on the screen: dnd-kit's delta
    // is that scrolling, and the grid's corner is now 130px higher.
    position.scrolled = 130;
    move(result, 50, 130);

    // In the grid the pointer is at 180, the second card's lower half. Counted twice it would
    // be at 310, below every card, and nothing would move.
    expect(result.current.drag?.order).toEqual(["p2", "p1", "p3"]);
  });

  it("puts the card down where its outline is, and says where", () => {
    const { result, drop } = renderDrag();
    start(result, "p1");
    expect(result.current.drag?.placementId).toBe("p1");
    move(result, 50, 230);
    act(() => result.current.onDragEnd());

    expect(drop).toHaveBeenCalledWith("p1", 2);
    expect(result.current.drag).toBe(null);
  });

  it("says a card put down where it was picked up stayed, and moves nothing", () => {
    const { result, drop, say } = renderDrag();
    start(result, "p2");
    expect(say).toHaveBeenLastCalledWith(dragMessages.pickedUp("Card p2"));
    act(() => result.current.onDragEnd());

    expect(drop).not.toHaveBeenCalled();
    expect(say).toHaveBeenLastCalledWith(
      dragMessages.droppedInPlace("Card p2")
    );
  });

  it("puts every card back on cancel, sliding them, and says nothing moved", () => {
    const { result, drop, say, flip } = renderDrag();
    start(result, "p1");
    move(result, 50, 230);
    flip.capture.mockClear();
    act(() => result.current.onDragCancel());

    expect(result.current.drag).toBe(null);
    expect(flip.capture).toHaveBeenCalledTimes(1);
    expect(drop).not.toHaveBeenCalled();
    expect(say).toHaveBeenLastCalledWith(dragMessages.cancelled());
  });
});

describe("a drag the dashboard's width changes under", () => {
  it("is cancelled when the dashboard narrows to one column, saying why and where the move still is", () => {
    const { result, rerender, say, drop } = renderDrag();
    start(result, "p1");
    move(result, 50, 230);
    rerender({ at: 390 });

    expect(result.current.drag).toBe(null);
    expect(result.current.enabled).toBe(false);
    expect(say).toHaveBeenLastCalledWith(dragMessages.cancelledByNarrowing());
    act(() => result.current.onDragEnd());
    expect(drop).not.toHaveBeenCalled();
  });

  it("is cancelled when the dashboard changes width but keeps its columns, since the cards moved", () => {
    const { result, rerender, say } = renderDrag();
    start(result, "p1");
    move(result, 50, 230);
    rerender({ at: 900 });

    expect(result.current.drag).toBe(null);
    expect(result.current.enabled).toBe(true);
    expect(say).toHaveBeenLastCalledWith(dragMessages.cancelledByResize());
  });
});
