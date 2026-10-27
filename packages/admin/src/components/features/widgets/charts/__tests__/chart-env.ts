/**
 * What a chart's tests need of jsdom that it does not give.
 *
 * - A size for the chart engine's container. jsdom lays nothing out, so every element measures 0
 *   by 0, and the engine draws nothing at a width of 0. Only the engine's own container is
 *   measured: `CHART_WIDTH` across and the height the chart set on it, so a test reads the marks
 *   as a card of that width would draw them.
 * - A pointer over a mark. A chart places the pointer by its client position less the drawing's
 *   left and top, which jsdom puts at 0, so a move to a mark's own coordinates is a move over
 *   that mark, as the engine draws it at `CHART_WIDTH`.
 * - The person's reduced-motion setting, which the shared setup always answers "no". A chart
 *   animated in starts its bars at no length, and jsdom never runs the animation on, so a test of
 *   the marks asks for reduced motion and reads them as drawn.
 *
 * @module components/features/widgets/charts/__tests__/chart-env
 */
import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/** The width the engine's container measures, in pixels. */
export const CHART_WIDTH = 320;

/**
 * Answers the reduced-motion query with `reduced`, and every other query "no". Called again in a
 * test, it changes the answer in place, leaving the engine's container sized.
 */
export function prefersReducedMotion(reduced: boolean): void {
  const answer = window.matchMedia;
  const spy = vi.isMockFunction(answer)
    ? answer
    : vi.spyOn(window, "matchMedia");
  const original = spy.getMockImplementation?.() ?? answer;
  spy.mockImplementation(query => ({
    ...original(query),
    matches: query === "(prefers-reduced-motion: reduce)" ? reduced : false,
  }));
}

/**
 * Sizes the engine's container for every test in the calling file, and asks for reduced motion
 * unless a test says otherwise with `prefersReducedMotion(false)`.
 */
export function sizeChartsInTests(): void {
  beforeEach(() => {
    prefersReducedMotion(true);
    const measure = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (!this.classList.contains("recharts-responsive-container")) {
          return measure.call(this);
        }
        // A chart that fills its card is drawn at the least height it is given here, where no
        // card around it has a height.
        const height = this.style.height.endsWith("%")
          ? Number.parseFloat(this.style.minHeight) || 0
          : Number.parseFloat(this.style.height) || 0;
        return DOMRect.fromRect({ width: CHART_WIDTH, height });
      }
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}

/** One animation frame, which the engine waits for before it acts on a pointer move. */
const nextFrame = () =>
  new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/**
 * Moves the pointer to `x`, `y` over a drawing. The move lands on the drawing itself, as it does
 * in a browser, where the engine's own surface takes no pointer; a frame passes after it, so any
 * work the move schedules has run.
 */
export async function pointAt(
  drawing: HTMLElement,
  x: number,
  y: number
): Promise<void> {
  if (!drawing.querySelector(".recharts-wrapper")) {
    throw new Error("the drawing has no engine wrapper: is it sized?");
  }
  await act(async () => {
    fireEvent.mouseMove(drawing, { clientX: x, clientY: y });
    await nextFrame();
  });
}

/** Moves the pointer over the middle of the bar's track in the row at `index` of a chart of groups. */
export function pointAtRow(drawing: HTMLElement, index: number): Promise<void> {
  const track = drawing.querySelectorAll(".recharts-bar-background-rectangle")[
    index
  ];
  if (!track) throw new Error(`the drawing has no row ${index}`);
  const [x, y, width, height] = ["x", "y", "width", "height"].map(name =>
    Number(track.getAttribute(name))
  ) as [number, number, number, number];
  return pointAt(drawing, x + width / 2, y + height / 2);
}

/**
 * Moves the pointer over the interval at `index` of `count` in a chart over time, at a card that
 * draws its gridlines: the plot runs from their start to their end.
 */
export function pointAtInterval(
  drawing: HTMLElement,
  index: number,
  count: number
): Promise<void> {
  const gridline = drawing.querySelector(".recharts-cartesian-grid line");
  if (!gridline)
    throw new Error(
      "the drawing has no gridlines: is it a medium or large card?"
    );
  const [left, right] = [
    Number(gridline.getAttribute("x1")),
    Number(gridline.getAttribute("x2")),
  ];
  const x = count > 1 ? left + ((right - left) * index) / (count - 1) : left;
  return pointAt(drawing, x, 30);
}
