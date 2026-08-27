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
import { afterEach, describe, expect, it, vi } from "vitest";

import { SQUARE_CORNERS } from "./border-radii";
import {
  canvasContentPoint,
  canvasContentRect,
  clippedByAncestor,
  clippedByAncestorRect,
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
  vi.unstubAllGlobals();
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

describe("a canvas that is PAINTED smaller than it is laid out", () => {
  /*
   * The editor scales the canvas so a tier wider than the region stays
   * editable. A transform is paint-time, so the root keeps its requested width
   * to layout — which is what keeps the container queries resolving at the tier
   * the author asked for — while every client rectangle comes back in painted
   * pixels.
   *
   * A canvas laid out at 1280 and painted at 912 is the measured case: a 1280px
   * tier inside the ~912px the canvas region gets on the supported 1280px
   * shell.
   */
  const SCALE = 912 / 1280;

  /** A root whose LAYOUT size differs from the rectangle it paints. */
  function scaledRoot(
    painted: { x: number; y: number; width: number; height: number },
    laidOut: { width: number; height: number },
    scroll: { left: number; top: number } = { left: 0, top: 0 }
  ) {
    const root = canvasRoot(painted, scroll);
    Object.defineProperty(root, "offsetWidth", { value: laidOut.width });
    Object.defineProperty(root, "offsetHeight", { value: laidOut.height });
    return root;
  }

  it("reports a child in CONTENT pixels, not painted ones", () => {
    const root = scaledRoot(
      { x: 100, y: 50, width: 912, height: 570 },
      { width: 1280, height: 800 }
    );
    // A block that sits 200 content pixels into the canvas and is 400 content
    // pixels wide paints at 0.7125 of each.
    const child = box({
      x: 100 + 200 * SCALE,
      y: 50 + 300 * SCALE,
      width: 400 * SCALE,
      height: 100 * SCALE,
    });

    expect(canvasContentRect(child, root)).toEqual({
      x: 200,
      y: 300,
      width: 400,
      height: 100,
    });
  });

  it("does NOT divide the scroll offset by the scale", () => {
    /*
     * The subtle half, and the one that reads as correct while drifting. A
     * scroll offset counts the root's own laid-out content, which a transform
     * never touches, so it is already in content pixels — divided along with
     * the client delta it shrinks by the zoom, and the whole overlay slides
     * further out the further the author scrolls.
     *
     * The separating property is a NON-ZERO scroll with a scale that is not 1:
     * either alone leaves the two implementations agreeing.
     */
    const root = scaledRoot(
      { x: 0, y: 0, width: 912, height: 570 },
      { width: 1280, height: 800 },
      { left: 0, top: 250 }
    );
    const child = box({
      x: 0,
      y: 300 * SCALE,
      width: 912,
      height: 100 * SCALE,
    });

    // 300 content pixels below the root's top edge, plus the 250 already
    // scrolled past — not 300 + 250 * SCALE, and not (300 + 250) * SCALE.
    expect(canvasContentRect(child, root).y).toBe(550);
  });

  it("keeps the pointer in the same space as the rectangles", () => {
    // The pairing this module exists to hold. Asserted against a measured
    // rectangle rather than against literals, because the fault is the two
    // disagreeing and two literal assertions would both pass while they did.
    const root = scaledRoot(
      { x: 100, y: 50, width: 912, height: 570 },
      { width: 1280, height: 800 },
      { left: 0, top: 250 }
    );
    const child = box({
      x: 100 + 200 * SCALE,
      y: 50 + 300 * SCALE,
      width: 400 * SCALE,
      height: 100 * SCALE,
    });
    const rect = canvasContentRect(child, root);

    // A pointer on the child's top-left corner, in viewport coordinates.
    expect(
      canvasContentPoint(100 + 200 * SCALE, 50 + 300 * SCALE, root)
    ).toEqual({ x: rect.x, y: rect.y });
  });

  it("is the IDENTITY when nothing has been laid out", () => {
    /*
     * jsdom lays nothing out, so `offsetWidth` is 0 and a ratio taken from it
     * would be `NaN` or `Infinity` — which would not fail loudly, it would
     * place every overlay at a nonsense coordinate. Unmeasurable means unscaled
     * here, which is what every caller assumed before there was a scale.
     */
    const root = canvasRoot({ x: 100, y: 50, width: 400, height: 800 });
    const child = box({ x: 140, y: 150, width: 200, height: 60 });

    expect(canvasContentRect(child, root)).toEqual({
      x: 40,
      y: 100,
      width: 200,
      height: 60,
    });
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

describe("a clipping ancestor inside a canvas that is PAINTED smaller", () => {
  /*
   * The two readings this comparison makes live on opposite sides of the
   * canvas's own scale: an element's rectangle comes from
   * `getBoundingClientRect` and is post-scale, while a computed border width is
   * unscaled CSS pixels. `renderedScale` stops BELOW the root on purpose — the
   * overlay is drawn through the root's scale already — so the root's own scale
   * reaches one reading and not the other unless it is composed back in.
   *
   * The failure is silent in the worst way: a child flush against the real
   * padding edge is classified as CLIPPED, and a clipped block has every
   * spacing band suppressed. The overlay stops drawing rather than drawing
   * something wrong.
   */
  /** An `overflow: hidden` ancestor with a border, at a painted rectangle. */
  function clipper(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) {
    const element = box(rect);
    Object.defineProperty(element, "ownerDocument", {
      value: document,
      configurable: true,
    });
    // A real border, or the inset is zero and the case cannot discriminate:
    // both a composed and an uncomposed scale multiply nothing by anything.
    element.setAttribute(
      "style",
      "overflow:hidden;border-style:solid;border-width:20px"
    );
    return element;
  }

  it("insets by the border as PAINTED, not as authored", () => {
    /*
     * A canvas laid out at 800 and painted at 400 is scaled by a half, so a
     * 20px border paints 10px. The child sits flush against the real padding
     * edge — 10 painted pixels inside the ancestor — and is not cut.
     *
     * Uncomposed, the inset is computed as the authored 20 and the child reads
     * as four slack-widths outside it.
     */
    const root = canvasRoot({ x: 0, y: 0, width: 400, height: 400 });
    Object.defineProperty(root, "offsetWidth", { value: 800 });
    Object.defineProperty(root, "offsetHeight", { value: 800 });

    const ancestor = clipper({ x: 0, y: 0, width: 400, height: 400 });
    root.append(ancestor);
    const child = box({ x: 10, y: 10, width: 100, height: 100 });
    ancestor.append(child);

    expect(clippedByAncestor(child, root, SQUARE_CORNERS)).toBe(false);
  });

  it("measures a root built by ANOTHER realm's constructor", () => {
    /*
     * The canvas can be portalled into a same-origin iframe, and each document
     * has its own `HTMLElement`. An ambient `instanceof HTMLElement` is false
     * for an ordinary div from that other realm, so a scaled canvas would be
     * treated as unscaled — substituting the identity precisely where the
     * composition is needed, and reintroducing the defect above only for the
     * surface that is hardest to notice it on.
     *
     * The separating property is that the element IS its own realm's
     * `HTMLElement` while not being this one's, which is exactly what a plain
     * `instanceof` cannot see.
     */
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument;
    expect(inner).not.toBeNull();
    if (inner === null) return;

    const foreign = inner.createElement("div");
    // The precondition the case rests on: a real element, from a real window,
    // that this realm's constructor does not claim.
    expect(foreign instanceof HTMLElement).toBe(false);
    expect(
      foreign instanceof
        (inner.defaultView as Window & typeof globalThis).HTMLElement
    ).toBe(true);

    foreign.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 400, height: 400, top: 0, left: 0 }) as DOMRect;
    Object.defineProperty(foreign, "offsetWidth", { value: 800 });
    Object.defineProperty(foreign, "offsetHeight", { value: 800 });

    const ancestor = clipper({ x: 0, y: 0, width: 400, height: 400 });
    foreign.append(ancestor);
    const child = box({ x: 10, y: 10, width: 100, height: 100 });
    ancestor.append(child);

    // The same flush-against-the-padding-edge child as above. Read through the
    // ambient constructor alone, the scale is 1 and this reads as clipped.
    expect(clippedByAncestor(child, foreign, SQUARE_CORNERS)).toBe(false);

    frame.remove();
  });

  it("still reports a child that IS cut", () => {
    /*
     * The control, and it has to come out the other way or the case above says
     * only that the function returns false. A child well outside the ancestor
     * is clipped at any scale, so a version that composed the scale wrongly in
     * the other direction — or one that always answered false — fails here.
     */
    const root = canvasRoot({ x: 0, y: 0, width: 400, height: 400 });
    Object.defineProperty(root, "offsetWidth", { value: 800 });
    Object.defineProperty(root, "offsetHeight", { value: 800 });

    const ancestor = clipper({ x: 0, y: 0, width: 400, height: 400 });
    root.append(ancestor);
    const child = box({ x: -200, y: 10, width: 100, height: 100 });
    ancestor.append(child);

    expect(clippedByAncestor(child, root, SQUARE_CORNERS)).toBe(true);
  });
});

/**
 * The two clip questions, and where they must give DIFFERENT answers.
 *
 * `clippedByAncestor` refuses a block whose square corner pokes past a more
 * tightly rounded ancestor's arc; `clippedByAncestorRect` asks about the
 * straight edges alone. That gap is the whole reason the second exists — the
 * appender draws a small control at a container's CENTRE, and refusing it for a
 * clip confined to a corner nothing is drawn near would decline `core/box`
 * inside `core/card`, which `card.tsx` calls the commonest composition in the
 * library. Routing the appender back through the corner-aware question would
 * bring that regression back, and every case below would stay green unless one
 * of them pins the disagreement itself.
 */
describe("the straight-edge clip question, against the corner-aware one", () => {
  /** An `overflow: hidden` ancestor with a rounded corner, at a painted rectangle. */
  function roundedClipper(
    rect: { x: number; y: number; width: number; height: number },
    radius: number
  ) {
    const element = box(rect);
    /*
     * LONGHANDS, and per axis. jsdom's computed style does not expand the
     * `overflow` or `border-radius` shorthands, so a fixture written with them
     * reports an empty string for every property this reads — and an empty
     * string is not `visible`, so the ancestor still counts as clipping while
     * its radii silently read as zero. The corner test would then never fire
     * and the two functions would agree for the wrong reason.
     */
    element.setAttribute(
      "style",
      [
        "overflow-x:hidden",
        "overflow-y:hidden",
        "border-style:solid",
        "border-width:0px",
        `border-top-left-radius:${radius}px`,
        `border-top-right-radius:${radius}px`,
        `border-bottom-right-radius:${radius}px`,
        `border-bottom-left-radius:${radius}px`,
      ].join(";")
    );
    return element;
  }

  it("agrees that a child well outside the clip rectangle is cut", () => {
    // Both questions answer the same way whenever the straight edges already
    // settle it, which is what makes the disagreement below a property of the
    // corner refinement rather than of one function being stricter throughout.
    const root = canvasRoot({ x: 0, y: 0, width: 400, height: 400 });
    const ancestor = roundedClipper(
      { x: 0, y: 0, width: 400, height: 400 },
      60
    );
    root.append(ancestor);
    const child = box({ x: -200, y: 10, width: 100, height: 100 });
    ancestor.append(child);

    expect(clippedByAncestor(child, root, SQUARE_CORNERS)).toBe(true);
    expect(clippedByAncestorRect(child, root)).toBe(true);
  });

  it("DIFFERS on a child cut only where the ancestor's corner is rounded", () => {
    /*
     * The child sits inside all four padding edges and its own square top-left
     * corner lies outside the ancestor's 60px arc — the `core/box` in
     * `core/card` composition. This is the fixture the whole trade rests on, so
     * its two assertions have to come out opposite: identical answers here
     * would mean the fixture never reached the corner test and the case would
     * license nothing.
     */
    const root = canvasRoot({ x: 0, y: 0, width: 400, height: 400 });
    const ancestor = roundedClipper(
      { x: 0, y: 0, width: 400, height: 400 },
      60
    );
    root.append(ancestor);
    const child = box({ x: 0, y: 0, width: 100, height: 100 });
    ancestor.append(child);

    expect(clippedByAncestor(child, root, SQUARE_CORNERS)).toBe(true);
    expect(clippedByAncestorRect(child, root)).toBe(false);
  });
});

/**
 * The parts of `DOMMatrix` `renderedScale` reads, and nothing else.
 *
 * jsdom implements no `DOMMatrix` at all, so `renderedScale` takes its
 * "nothing is laid out" branch and reports the identity — which is
 * describable. A rotated ancestor therefore cannot be expressed in this
 * environment without supplying one, and the refusal it triggers is the only
 * way any ancestor reaches the `cut` verdict, so nothing reaches that verdict
 * either.
 *
 * Only `a`..`f`, `is2D` and `multiply` are ever read, and only a
 * `matrix(a, b, c, d, e, f)` literal is ever parsed, because that is the form
 * the fixtures below declare. A stub narrower than the real interface is
 * honest here for the same reason a narrowed test double is anywhere: it
 * cannot answer a question the code does not ask.
 */
class Matrix2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
  readonly is2D = true;

  constructor(source?: string | readonly number[]) {
    const terms =
      typeof source === "string"
        ? source
            .slice(source.indexOf("(") + 1, source.lastIndexOf(")"))
            .split(",")
            .map(Number)
        : (source ?? [1, 0, 0, 1, 0, 0]);
    this.a = terms[0] ?? 1;
    this.b = terms[1] ?? 0;
    this.c = terms[2] ?? 0;
    this.d = terms[3] ?? 1;
    this.e = terms[4] ?? 0;
    this.f = terms[5] ?? 0;
  }

  /** `A.multiply(B)` is A·B, the composition the walk accumulates. */
  multiply(other: Matrix2D): Matrix2D {
    return new Matrix2D([
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d,
      this.a * other.e + this.c * other.f + this.e,
      this.b * other.e + this.d * other.f + this.f,
    ]);
  }
}

describe("a clipping ancestor whose transform cannot be described", () => {
  /*
   * `rotate(30deg)` on the ancestor. Neither reading survives it: `a` and `d`
   * stop being scale factors, and `getBoundingClientRect` answers with an
   * axis-aligned BOUNDING box whose edges are not the clip edges — the real
   * clip is a slanted rectangle inside it, so a child genuinely cut by it
   * still reads as contained on every straight-edge comparison. Both clip
   * questions refuse such an ancestor outright, and the child below is one
   * that BOTH would otherwise accept: it sits well inside the bounding box, so
   * nothing but the refusal itself can produce a `true` here.
   */
  function rotatedClipper(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) {
    const element = box(rect);
    element.setAttribute(
      "style",
      [
        "overflow-x:hidden",
        "overflow-y:hidden",
        // The composed matrix for a 30-degree rotation, written out because
        // the stub above reads matrix terms rather than parsing a rotation.
        "transform:matrix(0.8660254, 0.5, -0.5, 0.8660254, 0, 0)",
      ].join(";")
    );
    return element;
  }

  it("is refused by BOTH clip questions, not measured", () => {
    vi.stubGlobal("DOMMatrix", Matrix2D);
    const root = canvasRoot({ x: 0, y: 0, width: 400, height: 400 });
    const ancestor = rotatedClipper({ x: 0, y: 0, width: 400, height: 400 });
    root.append(ancestor);
    const child = box({ x: 100, y: 100, width: 100, height: 100 });
    ancestor.append(child);

    expect(clippedByAncestorRect(child, root)).toBe(true);
    expect(clippedByAncestor(child, root, SQUARE_CORNERS)).toBe(true);
  });

  it("accepts the same child once the ancestor is axis-aligned", () => {
    /*
     * The control, and it is what makes the case above about the ROTATION
     * rather than about the fixture. `matrix(1, 0, 0, 1, 0, 0)` is the
     * identity written in the same form, so the ancestor still declares a
     * transform and still clips; only the off-diagonal terms change.
     */
    vi.stubGlobal("DOMMatrix", Matrix2D);
    const root = canvasRoot({ x: 0, y: 0, width: 400, height: 400 });
    const ancestor = box({ x: 0, y: 0, width: 400, height: 400 });
    ancestor.setAttribute(
      "style",
      "overflow-x:hidden;overflow-y:hidden;transform:matrix(1, 0, 0, 1, 0, 0)"
    );
    root.append(ancestor);
    const child = box({ x: 100, y: 100, width: 100, height: 100 });
    ancestor.append(child);

    expect(clippedByAncestorRect(child, root)).toBe(false);
    expect(clippedByAncestor(child, root, SQUARE_CORNERS)).toBe(false);
  });
});
