"use client";

/**
 * The page itself, drawn small, on the screen an author reaches it from.
 *
 * The same `PageRenderer` that draws the published page. That is the property
 * worth protecting rather than an implementation convenience: a preview with
 * its own rendering path is a second implementation of "what does this page
 * look like", and the two drift in the direction nobody tests — the preview
 * stops matching the page while both look correct in isolation. `canvas.tsx`
 * makes the same argument for the editing surface, and it applies here for the
 * same reason.
 *
 * ## It is a picture, and it is inert
 *
 * Everything drawn inside is `inert` and `aria-hidden`. Not decoration: a page
 * is full of links, buttons and headings, and left reachable they would put a
 * whole second document into the tab order of a form — an author tabbing out of
 * the title field would walk into a miniature of their own page. The accessible
 * account is the text beside it, which says what the field holds and offers the
 * one action there is.
 *
 * ## `transform`, never `zoom`
 *
 * A deliberate divergence from the canvas, which uses `zoom`. `zoom`
 * participates in layout, and the canvas needs that: hit-testing, drag geometry
 * and the drop indicator are all positioned in the scaled box's own
 * coordinates. Nothing here is interactive, so participation buys nothing and
 * costs a reflow of the whole rendered tree on every resize.
 *
 * `transform` alone does NOT keep the scaled content out of the flow, which is
 * the trap: it removes the element from painting and leaves it in layout, so a
 * statically positioned child declared at the compose width stretches every
 * ancestor to that width. The scaled element is absolutely positioned for that
 * reason, and only then is the frame's measured width the column's width.
 *
 * ## An unmeasurable container renders UNSCALED
 *
 * A container reports zero width before layout, and in any environment that
 * does not lay out at all. Scaling by the measured ratio there multiplies the
 * page by zero and draws nothing — a blank frame that looks exactly like a page
 * with no content. Rendering unscaled instead is wrong only in how much of the
 * page is visible, and it is wrong visibly, which is the better failure.
 *
 * @module @nextlyhq/plugin-page-builder/admin/PageMiniature
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  PageRenderer,
  previewContainerStyle,
  type PageRendererProps,
} from "@nextlyhq/blocks-react";
import { useLayoutEffect, useRef, useState } from "react";

import { entryBlockResolver } from "./entry-block-resolver";
import type { PageRenderInputs } from "./page-render-inputs";

/**
 * The width the page is composed at before being scaled down.
 *
 * A desktop tier. A page laid out for desktop, rendered at the few hundred
 * pixels a form column offers, would draw its MOBILE layout — a truthful
 * rendering of a viewport the author was not looking at, which reads as the
 * page being wrong rather than as the preview being narrow.
 */
const DEFAULT_RENDER_WIDTH = 1280;

export interface PageMiniatureProps {
  /** The document to draw. */
  document: BlockDocument;
  /**
   * The site's compiled sheet.
   *
   * Spelled as the renderer's own prop type so the two cannot drift. The caller
   * decides whether it is ready; this draws whatever it is handed.
   */
  siteStyles: PageRendererProps["siteStyles"];
  /**
   * Everything else this site's rendering depends on — its breakpoints, the
   * container its responsive rules are compiled against, its remote-host policy
   * and its document caps.
   *
   * Taken as one bundle from `pageRenderInputs` rather than as loose props, so
   * this surface cannot be given three of the four. The canvas is handed the
   * same bundle.
   */
  render: PageRenderInputs;
  /** The width to compose at before scaling. Defaults to a desktop tier. */
  renderWidth?: number;
}

/**
 * @param props - the document, the site's sheet, and the width to compose at
 * @returns a clipped, inert, scaled rendering of the page
 */
export function PageMiniature({
  document,
  siteStyles,
  render,
  renderWidth = DEFAULT_RENDER_WIDTH,
}: PageMiniatureProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;

    const measure = (): void => {
      const width = element.clientWidth;
      // Zero means "not laid out", never "zero wide". See the module docblock.
      setScale(width > 0 ? width / renderWidth : 1);
    };

    measure();

    // Guarded rather than assumed: this component renders in the admin, in
    // tests, and anywhere a host embeds the form, and an environment without
    // the observer must still draw the page rather than throw on the way in.
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [renderWidth]);

  return (
    <div
      ref={frame}
      data-slot="page-miniature"
      // The box owns its own height through the aspect ratio, so a long page is
      // clipped rather than making the form scroll past a full-length preview.
      className="relative aspect-[16/10] w-full overflow-hidden rounded-md border border-border bg-background"
    >
      <div
        data-slot="page-miniature-scaled"
        /*
         * ABSOLUTE, and this is load-bearing rather than cosmetic.
         *
         * `transform` takes an element out of the PAINTING flow and leaves it
         * in the LAYOUT flow, so a statically positioned 1280px child still
         * contributes 1280px of intrinsic width to its ancestors — measured:
         * the frame's own `clientWidth` came back as 1280 rather than the
         * column's width, the scale computed from it was therefore 1, and the
         * page drew full-size and overflowed the form. Taking it out of flow is
         * what makes the frame's width a property of the COLUMN, which is the
         * width the scale has to be computed from.
         */
        className="absolute left-0 top-0"
        style={{
          width: `${renderWidth}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          /*
           * The container the compiled responsive rules resolve against, on the
           * element whose width they must answer for — the COMPOSED width, not
           * the clipped frame's. `@media` asks the window, so without this a
           * miniature composed at a desktop width gets whichever tier the admin
           * window happens to be in. `previewContainerStyle` supplies the
           * `container-type` beside the name, because a named container left at
           * the default `normal` is not a size-query container and every rule
           * the compile emitted stays inert.
           */
          ...previewContainerStyle(render.styleContext.previewContainer),
        }}
      >
        <div data-slot="page-miniature-surface" inert aria-hidden="true">
          <PageRenderer
            // Spread rather than listed field by field: the bundle owns which
            // inputs describe this site's rendering, and a surface restating
            // them here would silently stop forwarding one it never heard of.
            {...render}
            document={document}
            blocks={entryBlockResolver()}
            siteStyles={siteStyles}
          />
        </div>
      </div>
    </div>
  );
}
