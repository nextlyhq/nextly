/**
 * A measured width for the dashboard in jsdom, which lays nothing out.
 *
 * jsdom answers every `getBoundingClientRect()` with zero, which the width hooks read as "not
 * measured yet", and the grid asks nothing until the dashboard has a width. A test that renders
 * the grid gives the dashboard's container a width here, and can change it, which fires the
 * observers as a browser's layout would. jsdom cannot lay a card out in its cell either, so a
 * test that needs a card's own tier states the width every card measures.
 */
import { act } from "@testing-library/react";
import { vi } from "vitest";

const DASHBOARD_CONTAINER = "@container/dashboard";

let width = 1200;
let cardWidth: number | undefined;
const observers = new Set<ResizeObserver & { fire: () => void }>();
/** Puts back the prototype's own `getBoundingClientRect`; set while the stub is in place. */
let restoreMeasure: (() => void) | undefined;

/**
 * Measure the dashboard's container at `initial` pixels, and each card at `cardWidth` when it is
 * given, until `unstubDashboardWidth`.
 */
export function stubDashboardWidth(
  initial = 1200,
  cards: { cardWidth?: number } = {}
): void {
  width = initial;
  cardWidth = cards.cardWidth;
  observers.clear();
  restoreMeasure?.();
  // A plain function on the prototype, not a spy. `vi.spyOn` on an element whose INHERITED method
  // is already a spy hands back that same spy, so a test laying out its own nodes with
  // `vi.spyOn(node, ...)` would set one rectangle for every element on the page.
  const prototype = HTMLElement.prototype;
  const original = prototype.getBoundingClientRect;
  restoreMeasure = () => {
    prototype.getBoundingClientRect = original;
    restoreMeasure = undefined;
  };
  prototype.getBoundingClientRect = function (this: HTMLElement) {
    const measured = measuredWidth(this);
    if (measured === undefined) return original.call(this);
    return {
      width: measured,
      height: 0,
      top: 0,
      left: 0,
      right: measured,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.add(this as unknown as ResizeObserver & { fire: () => void });
      }
      fire() {
        this.callback([], this as unknown as ResizeObserver);
      }
      observe() {
        // The width is read from the stub above; there is nothing to watch.
      }
      unobserve() {
        // As `observe`.
      }
      disconnect() {
        observers.delete(
          this as unknown as ResizeObserver & { fire: () => void }
        );
      }
    }
  );
}

/** The width `element` lays out at: the dashboard's container, or a card when one is stated. */
function measuredWidth(element: HTMLElement): number | undefined {
  if (element.classList.contains(DASHBOARD_CONTAINER)) return width;
  return element.dataset.cardId === undefined ? undefined : cardWidth;
}

/** Give the dashboard a new width, and tell every observer, as a resize would. */
export function resizeDashboard(next: number): void {
  width = next;
  act(() => {
    for (const observer of observers) observer.fire();
  });
}

/** Undo `stubDashboardWidth`, for an `afterEach`. */
export function unstubDashboardWidth(): void {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreMeasure?.();
  observers.clear();
}
