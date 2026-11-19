"use client";

/**
 * The shell's canvas region: the strip and notices above the canvas, the
 * canvas scrolled in its region, and the panel body around them.
 *
 * @module shell-canvas-region
 */
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import * as React from "react";

import { useCanvasFrame } from "../canvas/canvas-frame-context";
import { CANVAS_FRAME_BOX_ATTRIBUTE } from "../canvas/geometry-dom";

/**
 * The canvas's region: a named `section`, never `<main>`.
 *
 * HTML allows one non-hidden `main` per document, and every mount this shell
 * has is inside a host that already owns it — the admin's dashboard layout
 * renders one, and the editor is embedded in it. A second gives assistive
 * technology two competing primary landmarks and makes every strict `main`
 * locator ambiguous. A `section` carrying an accessible name is still exposed
 * as a landmark, as a `region`.
 *
 * The ref and `tabIndex` belong to this element deliberately: F6 region
 * cycling focuses it, and dropping either would lose the canvas as a cycle
 * target — which reads as a focus bug rather than a markup change.
 */
/**
 * Whether `element` has content past its own box to scroll to, kept current
 * as it or what it holds changes size: the painted frame grows past the
 * region at a zoom, and the region narrows with the panels beside it.
 */
function useScrollsItsContent(element: HTMLElement | null): boolean {
  const [overflows, setOverflows] = React.useState(false);
  useIsomorphicLayoutEffect(() => {
    if (element === null) return;
    const measure = () => {
      setOverflows(
        element.scrollWidth > element.clientWidth ||
          element.scrollHeight > element.clientHeight
      );
    };
    measure();
    const view = element.ownerDocument.defaultView;
    if (view === null || typeof view.ResizeObserver !== "function") return;
    const sizes = new view.ResizeObserver(measure);
    /*
     * The region, and the painted frame's box inside it, whose size the zoom
     * changes while the region's own stays put. Found again whenever what
     * the region holds changes, since the frame mounts after the region.
     */
    const observe = () => {
      sizes.disconnect();
      sizes.observe(element);
      for (const box of Array.from(
        element.querySelectorAll(`[${CANVAS_FRAME_BOX_ATTRIBUTE}]`)
      )) {
        sizes.observe(box);
      }
      measure();
    };
    observe();
    const contents = new view.MutationObserver(observe);
    contents.observe(element, { childList: true, subtree: true });
    return () => {
      contents.disconnect();
      sizes.disconnect();
    };
  }, [element]);
  return overflows;
}

function CanvasRegion({
  regionRef,
  children,
}: {
  regionRef: (element: HTMLElement | null) => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  // The frame the canvas is drawn in, which focus arriving on the region is
  // handed on to.
  const canvasFrame = useCanvasFrame();
  const [element, setElement] = React.useState<HTMLElement | null>(null);
  const ref = React.useCallback(
    (next: HTMLElement | null) => {
      regionRef(next);
      setElement(next);
    },
    [regionRef]
  );
  const overflows = useScrollsItsContent(element);
  // Steps aside for the frame only while there is nothing here to scroll.
  const handsOn = canvasFrame.frame !== null && !overflows;
  return (
    <section
      ref={ref}
      /*
       * `0`, not `-1`, wherever this region SCROLLS: nothing inside it that
       * the keyboard can reach scrolls it — blocks are selected by pointer,
       * not by tab, and arrow keys in a frame scroll only the frame's own
       * page — so at `-1` a keyboard user could not scroll the canvas at all.
       * A canvas in this document, or a frame painted past the region at a
       * zoom.
       *
       * Otherwise a canvas in a frame is its own tab stop, and its page
       * scrolls inside it, so the region steps aside: `-1` keeps it
       * focusable for F6, and focus arriving on it goes on into the
       * frame. Kept as a stop as well it would be a trap — Shift+Tab
       * out of the frame would land here and be sent back in.
       */
      tabIndex={handsOn ? -1 : 0}
      onFocus={event => {
        if (!handsOn || event.target !== event.currentTarget) return;
        canvasFrame.frame?.focus();
      }}
      aria-label="Canvas"
      /*
       * Unpadded, so the page meets the region's edges and reads as the page
       * rather than a card inside a box. The frame is fitted into this
       * element's content box, so at the region's width it touches the
       * panels' dividers, and a narrower frame is centred in the well with
       * its hairline edge. Where the frame meets the region, the region
       * clips that edge, so it never doubles a divider.
       */
      className="nx-canvas-scroller h-full overflow-auto"
    >
      {children}
    </section>
  );
}

/**
 * Whether a host's node draws anything: `undefined`, `null` and a boolean
 * (what `cond && <Strip />` leaves) draw nothing, so no slot is made for
 * them.
 */
function drawsSomething(node: React.ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== "boolean";
}

/**
 * The canvas panel's contents: the strip, where the host gives one, above the
 * canvas's region rather than inside it (the region is what scrolls, so the
 * strip stays pinned while the page scrolls under it, its edges on the
 * region's as the page's are), then the region, with the checklist floated
 * over it.
 */
export function CanvasPanelBody({
  canvasStrip,
  checklist,
  regionRef,
  children,
}: {
  canvasStrip: React.ReactNode | undefined;
  checklist: React.ReactNode | undefined;
  regionRef: (element: HTMLElement | null) => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      {!drawsSomething(canvasStrip) ? null : (
        <div className="nx-canvas-strip-slot shrink-0">{canvasStrip}</div>
      )}
      {/* The canvas's region: see `CanvasRegion`. */}
      <div className="relative min-h-0 flex-1">
        <CanvasRegion regionRef={regionRef}>{children}</CanvasRegion>
        {checklist === undefined ? null : (
          // The positioner takes no pointer events, so it cannot swallow a
          // click aimed at the page underneath it; the card itself takes them
          // back.
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end p-4">
            <div className="pointer-events-auto">{checklist}</div>
          </div>
        )}
      </div>
    </div>
  );
}
