"use client";

/**
 * The page itself, drawn small, in a document of its own.
 *
 * The same `PageRenderer` that draws the published page. That is the property
 * worth protecting rather than an implementation convenience: a preview with
 * its own rendering path is a second implementation of "what does this page
 * look like", and the two drift in the direction nobody tests. `canvas.tsx`
 * makes the same argument for the editing surface.
 *
 * ## Why a frame, rather than markup placed in the admin's own document
 *
 * Three things go wrong when a published page is written straight into the
 * admin's document, and they are one mistake wearing three sets of clothes: the
 * page is being shown a world that is not its own.
 *
 * A NESTED FORM. The entry screen is itself a `<form>`, and a page holding the
 * form block emits one too. Nested forms are invalid HTML, and the cost depends
 * on how the document was built — which is worth stating exactly, because the
 * two paths differ and only one of them is live here.
 *
 * PARSED from HTML source, the inner start tag is dropped and the inner
 * `</form>` closes the OUTER form early. Measured in a browser on this exact
 * shape: a control following the nested form ends up outside the outer form
 * with `input.form === null` — no owner, so it submits nothing. This admin
 * renders client-side and ships no form markup, so it does not take that path
 * today; it would the moment any of this were server-rendered or hydrated.
 *
 * BUILT through the DOM, which is what React does here, a real nested form
 * exists and controls keep their nearest-ancestor owner. What is live in that
 * path is the page's own form being SUBMITTABLE from inside the entry form.
 *
 * A frame removes both, and removes the dependence on which path the admin
 * happens to use — which is the part worth having, since that is not this
 * module's decision to rely on.
 *
 * VIEWPORT UNITS. `50vw` measures the viewport, and composing an element at
 * 1280px does not make the viewport 1280px. In a 1600px admin window that block
 * draws 800px wide where the real page gives it 640px — a preview disagreeing
 * with the page while looking entirely correct.
 *
 * RELATIVE URLS. `images/hero.jpg` resolves against the address of the document
 * it sits in. In the admin that is the entry route, so the page asks for an
 * image under `/admin/...` and shows a gap where the site shows a photo.
 *
 * A frame answers all three by construction rather than by three separate
 * patches: its own document, its own viewport, its own base address. It is also
 * what `TemplatePreview` already does for the email preview, so this is a
 * second consumer of an established pattern rather than a new one.
 *
 * ## The frame is sandboxed with NOTHING granted
 *
 * `sandbox=""` blocks scripts, form submission and navigation outright, so the
 * preview cannot act even in principle. Stronger than the `inert` this
 * replaces, which governs focus and the accessibility tree and would not have
 * stopped a submit or a script.
 *
 * ## No preview container, deliberately
 *
 * The canvas compiles its sheet against a named container because it draws in
 * the admin's document, where `@media` asks the admin WINDOW. A frame has a
 * real viewport of its own, so plain `@media` already answers for the composed
 * width — which is exactly what the published page does. Compiling against a
 * container here would emit rules whose container is declared nowhere inside
 * the frame, and they would all sit inert.
 *
 * @module @nextlyhq/plugin-page-builder/admin/PageMiniature
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { PageRenderer, type PageRendererProps } from "@nextlyhq/blocks-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { entryBlockResolver } from "./entry-block-resolver";
import type { PageRenderInputs } from "./page-render-inputs";

/**
 * The width the page is composed at, and the frame's own viewport width.
 *
 * A desktop tier. A page laid out for desktop, composed at the few hundred
 * pixels a form column offers, would draw its MOBILE layout — a truthful
 * rendering of a viewport the author was not looking at, which reads as the
 * page being wrong rather than as the preview being narrow.
 */
const DEFAULT_RENDER_WIDTH = 1280;

/** The frame's aspect, and so the height its viewport reports to `vh`. */
const ASPECT = 10 / 16;

/**
 * Where the frame resolves a relative URL from.
 *
 * The site root rather than the entry route, which is the defect being closed.
 * It is not the published page's OWN address — a document served under a nested
 * path resolves `images/x` beneath that path — but the entry form does not know
 * where this page will be served, and the root is right for every top-level
 * page and closer than the admin route for the rest.
 */
const BASE_HREF = "/";

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
   * Everything else this site's rendering depends on — its breakpoints, its
   * remote-host policy and its document caps.
   *
   * Taken as one bundle from `pageRenderInputs` rather than as loose props, so
   * this surface cannot be given three of the four. The canvas is handed the
   * same bundle.
   */
  render: PageRenderInputs;
  /** The width to compose at. Defaults to a desktop tier. */
  renderWidth?: number;
}

/**
 * @param props - the document, the site's sheet, and the width to compose at
 * @returns a clipped, sandboxed frame holding a scaled rendering of the page
 */
export function PageMiniature({
  document,
  siteStyles,
  render,
  renderWidth = DEFAULT_RENDER_WIDTH,
}: PageMiniatureProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const height = Math.round(renderWidth * ASPECT);

  /*
   * Held apart from the measured scale, which changes on every frame of a
   * resize.
   *
   * Rebuilt inline, each observer callback would rerun the whole render —
   * sanitisation, migration, every block and the stylesheet compile — for a
   * page whose content did not change and whose frame only needed a new
   * transform. On a large document that is visible jank.
   */
  const srcDoc = useMemo(() => {
    const markup = renderToStaticMarkup(
      <PageRenderer
        // Spread rather than listed field by field: the bundle owns which
        // inputs describe this site's rendering, and a surface restating them
        // here would silently stop forwarding one it never heard of.
        {...render}
        document={document}
        blocks={entryBlockResolver()}
        siteStyles={siteStyles}
      />
    );
    // The default body margin is removed because the published page does not
    // have one, and an offset here would misreport where the page's own edge is.
    return `<!doctype html><html><head><meta charset="utf-8"><base href="${BASE_HREF}"><style>html,body{margin:0;padding:0}</style></head><body>${markup}</body></html>`;
  }, [render, document, siteStyles]);

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;

    const measure = (): void => {
      const width = element.clientWidth;
      // Zero means "not laid out", never "zero wide": scaling by it would
      // multiply the page to nothing and draw a blank frame, which looks
      // exactly like a page with no content.
      setScale(width > 0 ? width / renderWidth : 1);
    };

    measure();

    // Guarded rather than assumed: this renders in the admin, in tests, and
    // anywhere a host embeds the form, and an environment without the observer
    // must still draw the page rather than throw on the way in.
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [renderWidth]);

  return (
    <div
      ref={frame}
      data-slot="page-miniature"
      className="relative aspect-[16/10] w-full overflow-hidden rounded-md border border-border bg-background"
    >
      <iframe
        data-slot="page-miniature-surface"
        // Decorative. The accessible account of this field is the text beside
        // the frame, which says what the page holds and offers the one action
        // there is; a frame announced as a document would put a second one in
        // the reader's way. `tabIndex={-1}` keeps it out of the tab order, which
        // a frame otherwise joins.
        title=""
        aria-hidden="true"
        tabIndex={-1}
        // NOTHING granted. No scripts, no form submission, no navigation, so the
        // preview cannot act even in principle — and a page holding a form block
        // cannot submit one.
        sandbox=""
        srcDoc={srcDoc}
        /*
         * Absolute, and load-bearing rather than cosmetic. `transform` takes an
         * element out of the PAINTING flow and leaves it in the LAYOUT flow, so
         * an element declared at the compose width stretches every ancestor to
         * that width — the frame then measures its own width as the compose
         * width, the scale computed from it is 1, and the page draws full size
         * and overflows the form.
         */
        className="absolute left-0 top-0 border-0"
        style={{
          width: `${renderWidth}px`,
          height: `${height}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}
