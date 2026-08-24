// @vitest-environment jsdom

/**
 * The one DOM read in the frame mapping, and the one it kept getting wrong.
 *
 * `geometry.test.ts` covers the arithmetic, which takes plain numbers and needs
 * no browser. What is only true HERE is which measurements add up to the inset —
 * and the answer is the whole reason this module exists: the contract was once
 * documented as `clientLeft`/`clientTop`, three call sites followed that recipe,
 * and all three were short by the padding.
 *
 * So padding is the separating property throughout. A border-only fixture is
 * satisfied by exactly the implementation this function was written to replace,
 * which is why no case below leaves padding at zero without saying so.
 *
 * @module geometry-dom.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  canvasContentPoint,
  canvasContentRect,
  frameInsetOf,
  canvasRootFrom,
  hasScrollbarGutter,
  overflowApplies,
} from "./geometry-dom";

/**
 * A frame with known border and padding.
 *
 * `clientLeft`/`clientTop` are defined rather than styled: jsdom performs no
 * layout, so a border declared in CSS leaves both reading 0 and every assertion
 * would pass on an implementation that ignored borders entirely. Defining them
 * is what makes the border observable at all here.
 */
function frameWith({
  border,
  padding,
}: {
  border: { left: number; top: number };
  padding?: string;
}): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  if (padding !== undefined) frame.style.padding = padding;
  document.body.appendChild(frame);
  Object.defineProperty(frame, "clientLeft", { value: border.left });
  Object.defineProperty(frame, "clientTop", { value: border.top });
  return frame;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("frameInsetOf", () => {
  it("adds the padding to the border", () => {
    // THE case. An implementation reading `clientLeft`/`clientTop` alone
    // answers {left: 3, top: 5} here — which is the defect this module was
    // introduced to remove, and it is invisible in any zero-padding fixture.
    const frame = frameWith({
      border: { left: 3, top: 5 },
      padding: "7px 0 0 11px",
    });

    expect(frameInsetOf(frame)).toEqual({ left: 14, top: 12 });
  });

  it("reports the border alone when there is no padding", () => {
    // The control for the case above: it pins the border as still being read,
    // so a function that returned only padding would fail here rather than
    // passing both.
    const frame = frameWith({ border: { left: 4, top: 6 }, padding: "0px" });

    expect(frameInsetOf(frame)).toEqual({ left: 4, top: 6 });
  });

  it("reports the padding alone when there is no border", () => {
    // The mirror control. Together the three fix both coefficients at 1, which
    // neither a border-only nor a padding-only reader satisfies.
    const frame = frameWith({ border: { left: 0, top: 0 }, padding: "9px" });

    expect(frameInsetOf(frame)).toEqual({ left: 9, top: 9 });
  });

  it("keeps the border when a frame is detached and has no computed style", () => {
    // A frame outside a document has no view, so padding cannot be resolved.
    // The border is still readable, and reporting it beats guessing a padding
    // that would displace every mapped point — but the value must be a NUMBER:
    // an unparsed `NaN` propagates silently through the mapping and surfaces
    // later as coordinates that were never meaningful.
    const frame = document.createElement("iframe");
    Object.defineProperty(frame, "clientLeft", { value: 2 });
    Object.defineProperty(frame, "clientTop", { value: 3 });

    const inset = frameInsetOf(frame);

    expect(Number.isFinite(inset.left)).toBe(true);
    expect(Number.isFinite(inset.top)).toBe(true);
    expect(inset).toEqual({ left: 2, top: 3 });
  });

  it("never answers NaN, whatever the padding parses to", () => {
    // `parseFloat` on a value it cannot read returns NaN, and NaN survives
    // addition — so a single unreadable padding would poison the inset and
    // every point mapped through it, with no error anywhere.
    const frame = frameWith({ border: { left: 1, top: 1 } });
    frame.style.paddingLeft = "auto";
    frame.style.paddingTop = "auto";

    const inset = frameInsetOf(frame);

    expect(Number.isFinite(inset.left)).toBe(true);
    expect(Number.isFinite(inset.top)).toBe(true);
  });
});

/**
 * An element reporting a fixed viewport rectangle.
 *
 * Stubbed because jsdom lays nothing out and reports every element as
 * zero-sized, so a fixture built from real styles would measure zero against
 * zero and pass whatever the arithmetic did.
 */
function box(rect: { x: number; y: number; width: number; height: number }) {
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({ ...rect, top: rect.y, left: rect.x }) as DOMRect;
  return element;
}

/** A canvas root at a viewport position, optionally scrolled. */
function canvasRoot(
  rect: { x: number; y: number; width: number; height: number },
  scroll: { left: number; top: number } = { left: 0, top: 0 }
) {
  const root = box(rect);
  Object.defineProperty(root, "scrollLeft", { value: scroll.left });
  Object.defineProperty(root, "scrollTop", { value: scroll.top });
  return root;
}

describe("canvasContentRect", () => {
  it("reports a child relative to the canvas, not to the viewport", () => {
    // The separating property is the ROOT's own offset. A canvas at the origin
    // makes viewport and content coordinates identical, so a fixture placing
    // the root at 0,0 passes on an implementation that never subtracts it.
    const root = canvasRoot({ x: 100, y: 50, width: 400, height: 800 });
    const child = box({ x: 140, y: 150, width: 200, height: 60 });

    expect(canvasContentRect(child, root)).toEqual({
      x: 40,
      y: 100,
      width: 200,
      height: 60,
    });
  });

  it("does not move when the canvas is scrolled", () => {
    // THE case this function exists for. `getBoundingClientRect` answers in
    // viewport coordinates, so a scrolled canvas reports its children higher up
    // — and a rectangle stored raw drifts by exactly the scroll, which reads as
    // an overlay slowly going wrong rather than as a wrong measurement.
    const unscrolled = canvasRoot({ x: 0, y: 0, width: 400, height: 800 });
    const restingChild = box({ x: 0, y: 300, width: 400, height: 100 });

    // The same page scrolled down 250: the root stays put and the child's
    // viewport position moves up by the scroll.
    const scrolled = canvasRoot(
      { x: 0, y: 0, width: 400, height: 800 },
      { left: 0, top: 250 }
    );
    const scrolledChild = box({ x: 0, y: 50, width: 400, height: 100 });

    expect(canvasContentRect(scrolledChild, scrolled)).toEqual(
      canvasContentRect(restingChild, unscrolled)
    );
  });
});

describe("canvasContentPoint", () => {
  it("maps a pointer into the same space the rectangles are measured in", () => {
    // Asserted AGAINST a rectangle rather than against literals. The fault this
    // pairing prevents is the two disagreeing, and two independent assertions on
    // two sets of numbers would both pass while they disagreed with each other.
    const root = canvasRoot(
      { x: 100, y: 50, width: 400, height: 800 },
      { left: 0, top: 250 }
    );
    const child = box({ x: 140, y: 150, width: 200, height: 60 });
    const rect = canvasContentRect(child, root);

    // A pointer on the child's top-left corner, in viewport coordinates.
    expect(canvasContentPoint(140, 150, root)).toEqual({
      x: rect.x,
      y: rect.y,
    });
  });
});

describe("finding the canvas root across realms", () => {
  it("finds the root in the ordinary same-realm case", () => {
    const root = document.createElement("div");
    root.className = "nx-canvas";
    const child = document.createElement("p");
    root.appendChild(child);
    document.body.appendChild(root);

    expect(canvasRootFrom(child, "nx-canvas")).toBe(root);
    root.remove();
  });

  it("returns null when nothing above the element is a canvas root", () => {
    const lone = document.createElement("p");
    document.body.appendChild(lone);
    expect(canvasRootFrom(lone, "nx-canvas")).toBeNull();
    lone.remove();
  });

  it("accepts a root built by ANOTHER realm", () => {
    /*
     * The separating case. `instanceof HTMLElement` compares against the
     * constructor of the realm doing the asking, so a root created inside an
     * iframe is not an instance of THIS realm's `HTMLElement` — and chrome
     * checking it that way returns early and draws nothing on a perfectly good
     * canvas. The control below is the same object failing that naive check.
     */
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const inner = frame.contentDocument;
    if (inner === null) throw new Error("the iframe has no document");

    const root = inner.createElement("div");
    root.className = "nx-canvas";
    const child = inner.createElement("p");
    root.appendChild(child);
    inner.body.appendChild(root);

    // The naive check fails on it — which is what the helper exists to survive.
    expect(root instanceof HTMLElement).toBe(false);
    expect(canvasRootFrom(child, "nx-canvas")).toBe(root);

    frame.remove();
  });
});

describe("hasScrollbarGutter", () => {
  /**
   * A scroll container with a known gutter, in whichever realm is asked for.
   *
   * `offsetWidth` and `clientWidth` are DEFINED rather than styled, for the
   * reason `frameWith` defines its borders: jsdom lays nothing out, so both read
   * zero from real styles and the subtraction below would measure nothing.
   *
   * The LONGHANDS are set rather than the `overflow` shorthand, because jsdom
   * does not expand it: after `style.overflow = "auto"`, its `getComputedStyle`
   * answers `auto` for `overflow` and the empty string for `overflowX` and
   * `overflowY` — so a fixture written the natural way reads as a container that
   * does not scroll, and every assertion here would pass on an implementation
   * that never measured anything.
   */
  function scroller(
    doc: Document,
    { offset, client }: { offset: number; client: number }
  ): HTMLElement {
    const element = doc.createElement("div");
    element.style.overflowX = "auto";
    element.style.overflowY = "auto";
    doc.body.appendChild(element);
    Object.defineProperty(element, "offsetWidth", { value: offset });
    Object.defineProperty(element, "clientWidth", { value: client });
    Object.defineProperty(element, "offsetHeight", { value: 100 });
    Object.defineProperty(element, "clientHeight", { value: 100 });
    return element;
  }

  it("reports a reserved gutter", () => {
    // The control for the cross-realm case below: it pins the measurement as
    // actually happening, so a function that returned `false` unconditionally
    // would pass that one and fail this.
    const element = scroller(document, { offset: 200, client: 185 });
    expect(hasScrollbarGutter(element, { x: 0, y: 0 })).toBe(true);
  });

  it("reports no gutter on a container that reserves none", () => {
    // The mirror control. Without it, an implementation answering `true` for
    // every scroll container satisfies the two tests around this one.
    const element = scroller(document, { offset: 200, client: 200 });
    expect(hasScrollbarGutter(element, { x: 0, y: 0 })).toBe(false);
  });

  it("measures a scroll container built by ANOTHER realm", () => {
    /*
     * The separating case, and the one that fails silently in production: an
     * `instanceof HTMLElement` against the asking realm rejects a perfectly good
     * element from an iframe canvas BEFORE any measurement, so the gutter
     * refusal never fires and the block draws its padding bands across the
     * reserved scrollbar. The naive check is asserted below so the fixture
     * cannot quietly stop being cross-realm.
     */
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const inner = frame.contentDocument;
    if (inner === null) throw new Error("the iframe has no document");

    const element = scroller(inner, { offset: 200, client: 185 });

    expect(element instanceof HTMLElement).toBe(false);
    expect(hasScrollbarGutter(element, { x: 0, y: 0 })).toBe(true);

    frame.remove();
  });
});

describe("whether overflow clips at all", () => {
  /*
   * MEASURED in Chromium across the catalog's display set, by giving each value
   * `overflow: hidden` and a child pulled outside it with a negative margin,
   * then reading the pixels.
   *
   * The negative margin matters: an OVERSIZED child makes a table box grow to
   * fit, so "not clipped" would really mean "never overflowed" — which read as
   * six false entries on the first pass.
   */
  it.each([
    "inline",
    "inline list-item",
    "table-row",
    "table-row-group",
    "table-header-group",
    "table-footer-group",
    "ruby",
    "ruby-text",
    "contents",
  ])("says a %s box takes no clip", display => {
    expect(overflowApplies(display)).toBe(false);
  });

  it.each([
    "block",
    "inline-block",
    "flow-root",
    "list-item",
    "flow-root list-item",
    "flex",
    "inline-flex",
    "grid",
    "inline-grid",
    "table",
    "inline-table",
    "table-cell",
    "table-column",
    "table-column-group",
    "table-caption",
  ])("says a %s box does clip", display => {
    /*
     * The control half, and it carries the surprises: `table` and `table-cell`
     * clip normally while the row boxes between them do not, so a rule written
     * as "anything table-ish" would be wrong in both directions.
     */
    expect(overflowApplies(display)).toBe(true);
  });

  it.each(["ruby-base", "ruby-base-container", "ruby-text-container"])(
    "does not carry an entry for %s, which never arrives",
    display => {
      /*
       * All three compute to plain `block` in Chromium, so the computed value
       * this is asked about is never the declared one. An entry for them would
       * describe a value no element reports.
       */
      expect(overflowApplies(display)).toBe(true);
    }
  );
});
