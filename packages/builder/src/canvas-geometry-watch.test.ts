// @vitest-environment jsdom

/**
 * Which KIND of change a subscriber is told about.
 *
 * The distinction is load-bearing rather than cosmetic: an overlay that caches
 * something derived from the applied CSS — which width model a block is in,
 * which spacing edge responds — has to drop that cache when a media query can
 * have re-resolved, and must NOT drop it when the change might be its own
 * writing. Only the canvas frame resizing can re-resolve one, and a resize is
 * the one mechanism here that a caller's own probe cannot provoke.
 *
 * @module canvas-geometry-watch.test
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { type CanvasChange, watchCanvasFor } from "./canvas-geometry-watch";
import { CANVAS_ROOT_CLASS } from "./shell-state";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function canvas(): { root: HTMLElement; layer: HTMLElement } {
  const root = document.createElement("div");
  root.className = CANVAS_ROOT_CLASS;
  const layer = document.createElement("div");
  root.append(layer);
  document.body.append(root);
  return { root, layer };
}

/** Deliver one `ResizeObserver` batch to the subscription just installed. */
function resized(targets: readonly Element[]): void {
  const observer = FakeResizeObserver.instances.at(-1);
  observer?.callback(
    targets.map(target => ({ target }) as ResizeObserverEntry),
    observer as unknown as ResizeObserver
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeResizeObserver.instances = [];
  document.body.replaceChildren();
});

describe("which kind of change a subscriber is told about", () => {
  it("calls the canvas frame resizing a resize", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { root, layer } = canvas();
    const seen: CanvasChange[] = [];
    const stop = watchCanvasFor(
      () => layer,
      change => seen.push(change)
    );
    resized([root]);
    expect(seen).toEqual(["resized"]);
    stop?.();
  });

  /*
   * A NODE resizing is not one. An image finishing its load moves rectangles
   * without altering a single declaration, so an answer derived from the
   * applied CSS is still good — and re-deriving it costs a forced layout per
   * edge on a change that happens in bursts.
   */
  it("does not call a node resizing one", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { root, layer } = canvas();
    const node = document.createElement("div");
    root.append(node);
    const seen: CanvasChange[] = [];
    const stop = watchCanvasFor(
      () => layer,
      change => seen.push(change)
    );
    resized([node]);
    expect(seen).toEqual(["moved"]);
    stop?.();
  });

  it("still calls it a resize when the frame is one of several", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { root, layer } = canvas();
    const node = document.createElement("div");
    root.append(node);
    const seen: CanvasChange[] = [];
    const stop = watchCanvasFor(
      () => layer,
      change => seen.push(change)
    );
    resized([node, root]);
    expect(seen).toEqual(["resized"]);
    stop?.();
  });

  /*
   * A SCROLL is a move with no size change at all, and nothing about the
   * cascade can have changed under it.
   */
  it("does not call a scroll a resize", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { root, layer } = canvas();
    const seen: CanvasChange[] = [];
    const stop = watchCanvasFor(
      () => layer,
      change => seen.push(change)
    );
    root.dispatchEvent(new Event("scroll", { bubbles: false }));
    expect(seen).toEqual(["moved"]);
    stop?.();
  });
});
