/**
 * Resizing a card by dragging its right edge: which cards have an edge, the width it snaps to as
 * the pointer moves, and what release and a cancel keep.
 *
 * jsdom lays nothing out, so the grid is given its corner on the screen and the card its left
 * edge within the grid; the pointer's events are handed to the edge's handlers as React would.
 * The grid is 1,200px wide: 16px gaps, so a column with its gap is 101⅓px.
 */
import type { WidgetSizeBounds } from "nextly/config";
import type { PointerEvent as ReactPointerEvent } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ArrangedWidget } from "../../useDashboardArrangement";
import { CELL_PLACEMENT_ATTRIBUTE } from "../cell-placement";
import { useCardResize, type CardEdge } from "../useCardResize";

const WIDTH = 1200;

/** The middle of the gap after a card from the grid's left edge, `w` columns wide. */
const gapAfter = (w: number) => (w * (WIDTH - 11 * 16)) / 12 + (w - 1) * 16 + 8;

const RESIZABLE: WidgetSizeBounds = {
  default: { w: 6, h: 3 },
  min: { w: 3, h: 2 },
  max: { w: 12, h: 6 },
};

/** Up to 66%, as core's Count is. */
const CAPPED: WidgetSizeBounds = {
  default: { w: 3, h: 2 },
  min: { w: 3, h: 2 },
  max: { w: 8, h: 3 },
};

/** One width only. */
const FIVE_ONLY: WidgetSizeBounds = {
  default: { w: 5, h: 2 },
  min: { w: 5, h: 2 },
  max: { w: 5, h: 2 },
};

function row(bounds: WidgetSizeBounds, w: number): ArrangedWidget {
  return {
    placementId: "p1",
    size: { w, h: bounds.default.h },
    widget: { title: "Card", size: bounds },
  } as unknown as ArrangedWidget;
}

/** The grid, with one cell at its left edge and the edge inside the cell. */
function stubGrid(): { grid: HTMLElement; edge: HTMLElement } {
  const grid = document.createElement("section");
  grid.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: WIDTH, right: WIDTH }) as DOMRect;
  const cell = document.createElement("div");
  cell.setAttribute(CELL_PLACEMENT_ATTRIBUTE, "p1");
  Object.defineProperty(cell, "offsetLeft", { value: 0 });
  const edge = document.createElement("div");
  cell.append(edge);
  grid.append(cell);
  return { grid, edge };
}

function renderResize(width = WIDTH) {
  const { grid, edge } = stubGrid();
  const setSize = vi.fn();
  const flip = { capture: vi.fn() };
  const hook = renderHook(
    ({ at }: { at: number }) =>
      useCardResize({ width: at, gridRef: { current: grid }, flip, setSize }),
    { initialProps: { at: width } }
  );
  return { ...hook, edge, setSize, flip };
}

/** A pointer event on the edge, at `clientX`. */
function pointer(
  edge: HTMLElement,
  clientX: number
): ReactPointerEvent<HTMLElement> {
  return {
    button: 0,
    pointerId: 1,
    clientX,
    currentTarget: edge,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  } as unknown as ReactPointerEvent<HTMLElement>;
}

/** Picks the edge up, moves it to each of `xs` in turn, and leaves it held. */
function dragTo(
  edgeOf: () => CardEdge | undefined,
  element: HTMLElement,
  xs: number[]
): void {
  act(() => edgeOf()?.onPointerDown(pointer(element, gapAfter(6))));
  for (const x of xs) {
    act(() => edgeOf()?.onPointerMove(pointer(element, x)));
  }
}

describe("a card's edge", () => {
  it("snaps a 50% card to 33% as it is dragged in, showing the width while held, and stages it on release", () => {
    const { result, edge, setSize, flip } = renderResize();
    const edgeOf = () => result.current.edgeFor(row(RESIZABLE, 6));
    dragTo(edgeOf, edge, [gapAfter(4) + 10]);

    expect(result.current.resizing).toEqual({
      placementId: "p1",
      w: 4,
      from: 6,
    });
    // The other cards' places were noted before the grid reflowed, so they slide to fit.
    expect(flip.capture).toHaveBeenCalled();
    expect(setSize).not.toHaveBeenCalled();

    act(() => edgeOf()?.onPointerUp(pointer(edge, gapAfter(4))));
    expect(result.current.resizing).toBe(null);
    expect(setSize).toHaveBeenCalledWith("p1", { w: 4, h: 3 });
  });

  it("snaps a 50% card to 100% dragged to the end of the row", () => {
    const { result, edge, setSize } = renderResize();
    const edgeOf = () => result.current.edgeFor(row(RESIZABLE, 6));
    dragTo(edgeOf, edge, [gapAfter(9), gapAfter(12) - 20]);
    act(() => edgeOf()?.onPointerUp(pointer(edge, gapAfter(12))));

    expect(setSize).toHaveBeenCalledWith("p1", { w: 12, h: 3 });
  });

  it("stops at the widest width the widget allows however far it is dragged", () => {
    const { result, edge, setSize } = renderResize();
    const edgeOf = () => result.current.edgeFor(row(CAPPED, 3));
    expect(edgeOf()?.choices).toEqual([3, 4, 6, 8]);
    dragTo(edgeOf, edge, [gapAfter(12), WIDTH * 3]);

    expect(result.current.resizing?.w).toBe(8);
    act(() => edgeOf()?.onPointerUp(pointer(edge, WIDTH * 3)));
    expect(setSize).toHaveBeenCalledWith("p1", { w: 8, h: 2 });
  });

  it("is not offered on a card bounded 5 to 5, which has one width", () => {
    const { result } = renderResize();
    expect(result.current.edgeFor(row(FIVE_ONLY, 5))).toBe(undefined);
  });

  it("is not offered below 1,024px, where widths are drawn in bands", () => {
    const { result } = renderResize(1000);
    expect(result.current.enabled).toBe(false);
    expect(result.current.edgeFor(row(RESIZABLE, 6))).toBe(undefined);
  });

  it("stages nothing when released at the width it was picked up at", () => {
    const { result, edge, setSize } = renderResize();
    const edgeOf = () => result.current.edgeFor(row(RESIZABLE, 6));
    dragTo(edgeOf, edge, [gapAfter(4), gapAfter(6) + 3]);
    act(() => edgeOf()?.onPointerUp(pointer(edge, gapAfter(6))));

    expect(setSize).not.toHaveBeenCalled();
  });

  it("puts the card back when cancelled, as Escape does, sliding the others back too", () => {
    const { result, edge, setSize, flip } = renderResize();
    const edgeOf = () => result.current.edgeFor(row(RESIZABLE, 6));
    dragTo(edgeOf, edge, [gapAfter(12)]);
    flip.capture.mockClear();
    act(() => result.current.cancel());

    expect(result.current.resizing).toBe(null);
    expect(flip.capture).toHaveBeenCalledTimes(1);
    act(() => edgeOf()?.onPointerUp(pointer(edge, gapAfter(12))));
    expect(setSize).not.toHaveBeenCalled();
  });

  it("puts the card back when the dashboard narrows below 1,024px mid-drag", () => {
    const { result, rerender, edge, setSize } = renderResize();
    const edgeOf = () => result.current.edgeFor(row(RESIZABLE, 6));
    dragTo(edgeOf, edge, [gapAfter(12)]);
    rerender({ at: 900 });

    expect(result.current.resizing).toBe(null);
    expect(setSize).not.toHaveBeenCalled();
  });
});
