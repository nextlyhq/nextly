"use client";

/**
 * The cue over the site's own layout around the canvas: on a page the site
 * serves, its header, footer and the rest are faded and inert, and an author
 * pointing at them is told why they cannot be clicked.
 *
 * Drawn in the editor's document, over the frame, rather than in the page:
 * inert content takes no hover or focus, so nothing inside the page could
 * answer the pointer, and the editor's own words and tokens never reach the
 * site's page this way. Each cue covers one element of the site's layout,
 * placed from where that element is in the frame's viewport, at the scale the
 * frame is painted at, and placed again as the page scrolls or resizes.
 *
 * @module site-chrome-cues
 */
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import * as React from "react";

import {
  boxInFrameViewport,
  CHROME_BLEED,
  framePaintedScale,
} from "./geometry-dom";

/** The words on the cue's tag. */
const SITE_CHROME_CUE_TAG = "Part of your site’s layout";

/** The cue's tooltip: what the region is, and where it is changed. */
const SITE_CHROME_CUE_TITLE =
  "Part of your site’s layout. It comes from your site’s code and can’t be edited here.";

/** Place each cue over the element it covers, in the layer's space. */
function placeCues(
  frame: HTMLIFrameElement,
  elements: readonly Element[],
  cues: readonly (HTMLDivElement | null)[]
): void {
  const scale = framePaintedScale(frame);
  elements.forEach((element, at) => {
    const cue = cues[at];
    if (cue == null) return;
    const box = boxInFrameViewport(element);
    // An element that draws nothing, such as an empty announcer, gets no cue.
    cue.hidden = box.width === 0 || box.height === 0;
    // The layer starts CHROME_BLEED up and left of the frame's viewport, so
    // a cue is placed past it by as much to lie over its part.
    cue.style.left = `${String(box.x * scale + CHROME_BLEED)}px`;
    cue.style.top = `${String(box.y * scale + CHROME_BLEED)}px`;
    cue.style.width = `${String(box.width * scale)}px`;
    cue.style.height = `${String(box.height * scale)}px`;
  });
}

/**
 * One cue per element of the site's layout around the canvas, inside the
 * chrome layer over the frame.
 *
 * @internal
 */
export function SiteChromeCues({
  frame,
  page,
  elements,
  scale,
}: {
  frame: HTMLIFrameElement | null;
  page: Document | null;
  elements: readonly Element[];
  /** The scale asked for, so a zoom places the cues again. */
  scale: number;
}): React.JSX.Element | null {
  const cues = React.useRef<(HTMLDivElement | null)[]>([]);
  useIsomorphicLayoutEffect(() => {
    const view = page?.defaultView;
    if (frame === null || page === null || view == null) return;
    if (elements.length === 0) return;
    const place = (): void => placeCues(frame, elements, cues.current);
    place();
    // From the frame's window, the realm of the elements it observes.
    const Sizes = view.ResizeObserver;
    const sizes = typeof Sizes === "function" ? new Sizes(place) : null;
    for (const element of elements) sizes?.observe(element);
    // A part can MOVE without changing size — a footer pushed down as the
    // page above it grows — and only the page's own size says so.
    sizes?.observe(page.documentElement);
    if (page.body !== null) sizes?.observe(page.body);
    // A viewport's scroll is dispatched at its document.
    page.addEventListener("scroll", place, { passive: true });
    view.addEventListener("resize", place);
    return () => {
      sizes?.disconnect();
      page.removeEventListener("scroll", place);
      view.removeEventListener("resize", place);
    };
  }, [frame, page, elements, scale]);
  if (elements.length === 0) return null;
  return (
    <>
      {elements.map((_, at) => (
        <div
          // The elements are the page's, held in the order they were found;
          // a new set re-renders the cues whole.
          key={at}
          ref={cue => {
            cues.current[at] = cue;
          }}
          className="nx-site-chrome-cue"
          title={SITE_CHROME_CUE_TITLE}
          // A pointer cue: the region is inert in the page, so a keyboard or
          // screen reader never reaches it, and the cue has nothing to add.
          aria-hidden="true"
        >
          <span className="nx-site-chrome-cue__tag">{SITE_CHROME_CUE_TAG}</span>
        </div>
      ))}
    </>
  );
}
