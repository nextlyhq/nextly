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
 * the title field would walk into a miniature of their own page.
 *
 * What IS reachable is one link per section, laid over the picture outside the
 * inert subtree: a person points at the part of the page they want to change
 * and lands on it in the builder. Each is named for its section, so a screen
 * reader hears "Section 4, Pricing: Plans for teams" rather than the page's own
 * markup.
 *
 * ## As tall as the page, up to a cap
 *
 * The page is shown at the column's width and its own height, up to
 * `maxHeight`; a longer page scrolls inside the frame. A fixed aspect cut a
 * long page off after its first screen, and the point of the preview is that
 * an author can read what the page says without opening the editor.
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
  NODE_ID_ATTRIBUTE,
  PageRenderer,
  previewContainerStyle,
  type PageRendererProps,
} from "@nextlyhq/blocks-react";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

import { entryBlockResolver } from "./entry-block-resolver";
import type { PageRenderInputs } from "./page-render-inputs";
import { navigateWithin } from "./plain-click";
import { useFirstSeen } from "./use-first-seen";

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
  /** The most of the page's height shown before the frame scrolls, in px. */
  maxHeight?: number;
  /**
   * The page's sections a person may open, each by its block's id, with the
   * name a screen reader announces and the address it opens. Absent, the
   * preview is a picture only — for a reader who may not edit the page.
   */
  sections?: readonly MiniatureSection[];
  /** Moves to a section's address within the admin, keeping the form mounted. */
  onNavigate?: (href: string) => void;
}

/** One section a person may open from the preview. */
export interface MiniatureSection {
  id: string;
  /**
   * Every top-level node the section is drawn as, when it is more than its
   * own: a placed component's definition can have several roots. The link
   * covers them all. Absent means the section is `id` alone.
   */
  parts?: readonly string[];
  name: string;
  href: string;
}

/** Where a section is drawn, in the frame's own on-screen pixels. */
interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The least height a section's link takes, in px. A thin section — a divider
 * is a few pixels tall once scaled — would otherwise be a target nobody can hit
 * by pointer or touch; WCAG 2.5.8 asks for 24 by 24.
 */
const MIN_TARGET = 24;

/**
 * One axis of a section's link: its start and length, grown to the least
 * target about its own middle and kept within the page along that axis, whose
 * frame clips anything past its edges. A section at an edge grows inward; a
 * page shorter than the target cannot hold it, and starts at the edge.
 */
function growAxis(
  start: number,
  length: number,
  limit: number
): { start: number; length: number } {
  if (length >= MIN_TARGET) return { start, length };
  const centred = start - (MIN_TARGET - length) / 2;
  return {
    start: Math.max(0, Math.min(centred, limit - MIN_TARGET)),
    length: MIN_TARGET,
  };
}

/**
 * Where a section's link goes: over the section, grown to the least target in
 * each direction and kept within the page's on-screen box. Unmeasured, it
 * takes no room rather than covering the page.
 */
function linkBox(
  box: Box | undefined,
  page: { width: number; height: number }
): CSSProperties {
  if (box === undefined) return { top: 0, left: 0, width: 0, height: 0 };
  const down = growAxis(box.top, box.height, page.height);
  const across = growAxis(box.left, box.width, page.width);
  const grown = down.length !== box.height || across.length !== box.width;
  return {
    top: down.start,
    height: down.length,
    left: across.start,
    width: across.length,
    // A grown link is drawn above its neighbours, whose links it now
    // overlaps: drawn later, they would otherwise cover most of it again.
    // They lose a few pixels of a target many times larger.
    ...(grown ? { zIndex: 1 } : {}),
  };
}

/** How much of the page is shown before the frame scrolls, by default. */
const DEFAULT_MAX_HEIGHT = 640;

/**
 * Where each section is drawn, relative to the page's own box.
 *
 * Read from the rendered page rather than worked out from the document: a
 * section's height is whatever its content and the site's styles make it, and
 * only the browser knows that. Measured in on-screen pixels on both sides, so
 * the scale is already in the numbers.
 */
function measureBoxes(
  page: HTMLElement,
  sections: readonly MiniatureSection[]
): Record<string, Box> {
  const origin = page.getBoundingClientRect();
  const drawn = new Map<string, Element>();
  for (const element of page.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`)) {
    const id = element.getAttribute(NODE_ID_ATTRIBUTE);
    // The first element per id is the section's own root; a nested block
    // never shares a top-level block's id after the renderer's id repair.
    if (id !== null && !drawn.has(id)) drawn.set(id, element);
  }
  const boxes: Record<string, Box> = {};
  for (const { id, parts = [id] } of sections) {
    // The smallest box around every part that is drawn.
    const rects = parts
      .map(part => drawn.get(part)?.getBoundingClientRect())
      .filter(rect => rect !== undefined);
    if (rects.length === 0) continue;
    const top = Math.min(...rects.map(rect => rect.top));
    const left = Math.min(...rects.map(rect => rect.left));
    const bottom = Math.max(...rects.map(rect => rect.bottom));
    const right = Math.max(...rects.map(rect => rect.right));
    boxes[id] = {
      top: top - origin.top,
      left: left - origin.left,
      width: right - left,
      height: bottom - top,
    };
  }
  return boxes;
}

/**
 * The scale that fits the composed width into the frame, kept current as the
 * frame resizes.
 */
function useScale(
  frame: RefObject<HTMLDivElement | null>,
  renderWidth: number
): number {
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
  }, [frame, renderWidth]);
  return scale;
}

/**
 * The page's own height at the composed width, and where its sections are.
 *
 * Read together, and again whenever the page's own box changes size: an image
 * arriving, a font swapping in, or the scale moving all move the sections
 * under the links. Zero and none until the page is drawn.
 */
function usePageLayout(
  drawn: boolean,
  scale: number,
  scaled: RefObject<HTMLDivElement | null>,
  pageBox: RefObject<HTMLDivElement | null>,
  sections: readonly MiniatureSection[] | undefined
): { composedHeight: number; boxes: Record<string, Box> } {
  const [composedHeight, setComposedHeight] = useState(0);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});

  const measure = useCallback((): void => {
    const element = scaled.current;
    const page = pageBox.current;
    if (!element || !page) return;
    setComposedHeight(element.offsetHeight);
    setBoxes(sections === undefined ? {} : measureBoxes(page, sections));
  }, [scaled, pageBox, sections]);

  useLayoutEffect(() => {
    if (!drawn) return;
    measure();
    const element = scaled.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [drawn, scale, measure, scaled]);

  return { composedHeight, boxes };
}

/** The page at its composed width, scaled into the frame, and inert. */
function ScaledPage({
  scaledRef,
  renderWidth,
  scale,
  previewContainer,
  children,
}: {
  scaledRef: RefObject<HTMLDivElement | null>;
  renderWidth: number;
  scale: number;
  previewContainer: PageRenderInputs["styleContext"]["previewContainer"];
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      ref={scaledRef}
      data-slot="page-miniature-scaled"
      /*
       * ABSOLUTE, and this is load-bearing rather than cosmetic.
       *
       * `transform` takes an element out of the PAINTING flow and leaves
       * it in the LAYOUT flow, so a statically positioned 1280px child
       * still contributes 1280px of intrinsic width to its ancestors —
       * measured: the frame's own `clientWidth` came back as 1280 rather
       * than the column's width, the scale computed from it was therefore
       * 1, and the page drew full-size and overflowed the form. Taking it
       * out of flow is what makes the frame's width a property of the
       * COLUMN, which is the width the scale has to be computed from.
       */
      className="absolute left-0 top-0"
      style={{
        width: `${renderWidth}px`,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        /*
         * The container the compiled responsive rules resolve against, on
         * the element whose width they must answer for — the COMPOSED
         * width, not the clipped frame's. `@media` asks the window, so
         * without this a miniature composed at a desktop width gets
         * whichever tier the admin window happens to be in.
         * `previewContainerStyle` supplies the `container-type` beside the
         * name, because a named container left at the default `normal` is
         * not a size-query container and every rule the compile emitted
         * stays inert.
         */
        ...previewContainerStyle(previewContainer),
      }}
    >
      <div
        data-slot="page-miniature-surface"
        inert
        aria-hidden="true"
        /*
         * A submit raised anywhere in the page cannot reach the form this
         * miniature sits inside.
         *
         * The entry screen is a `<form>`, and a page holding a form block
         * emits one too — so the preview contains a nested form, which is
         * invalid HTML. What that costs depends on how the document was
         * built, and only one path is live here:
         *
         * PARSED from HTML source, the inner `</form>` closes the OUTER
         * form early. Measured on this exact shape: a control after the
         * nested form reports `input.form === null` — no owner, so it
         * submits nothing. The admin ships no form markup and builds its
         * tree through the DOM, so it does not take that path today.
         *
         * BUILT through the DOM, which is what happens here, a real nested
         * form exists and controls keep their nearest-ancestor owner. The
         * live risk is a submit from the previewed page reaching the entry
         * form, and this is what refuses it.
         *
         * Captured on the WAY DOWN rather than bubbling, so it lands before
         * any handler inside the page, and matched by the EVENT rather than
         * by a block's name: a host's own form-rooted block raises the same
         * event and is refused by the same line, where a check for
         * `core/form` would have let it through.
         */
        onSubmitCapture={event => event.preventDefault()}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One link over each section, outside the scaled page so its ring is drawn at
 * full size rather than shrunk with the page, and above it.
 */
function SectionLinks({
  sections,
  boxes,
  page,
  onNavigate,
}: {
  sections: readonly MiniatureSection[];
  boxes: Record<string, Box>;
  /** The page's size on screen, which no link may extend past. */
  page: { width: number; height: number };
  onNavigate: (href: string) => void;
}): JSX.Element {
  return (
    <>
      {sections.map(section => (
        <a
          key={section.id}
          href={section.href}
          aria-label={section.name}
          data-slot="page-miniature-section"
          className="absolute block rounded-sm outline-none ring-inset ring-primary/60 hover:ring-2 focus-visible:ring-2 focus-visible:ring-ring"
          style={linkBox(boxes[section.id], page)}
          {...navigateWithin(section.href, onNavigate)}
        />
      ))}
    </>
  );
}

/**
 * How tall the frame and the page inside it are: the page as tall as it is on
 * screen, and the frame as tall as that up to the cap. Unmeasured, the frame
 * keeps a page-like shape rather than none.
 */
function frameSize(
  shownHeight: number,
  maxHeight: number
): {
  frame: CSSProperties | undefined;
  frameClass: string;
  page: CSSProperties | undefined;
} {
  if (shownHeight <= 0) {
    return { frame: undefined, frameClass: "aspect-[16/10]", page: undefined };
  }
  return {
    frame: { height: Math.min(shownHeight, maxHeight) },
    frameClass: "",
    page: { height: shownHeight },
  };
}

/**
 * @param props - the document, the site's sheet, the width to compose at, and
 *   the sections a person may open
 * @returns a scaled, inert rendering of the page, with a link over each section
 */
export function PageMiniature({
  document,
  siteStyles,
  render,
  renderWidth = DEFAULT_RENDER_WIDTH,
  maxHeight = DEFAULT_MAX_HEIGHT,
  sections,
  onNavigate,
}: PageMiniatureProps): JSX.Element {
  const frame = useRef<HTMLDivElement>(null);
  const pageBox = useRef<HTMLDivElement>(null);
  const scaled = useRef<HTMLDivElement>(null);
  const seen = useFirstSeen(frame);
  const scale = useScale(frame, renderWidth);
  const { composedHeight, boxes } = usePageLayout(
    seen,
    scale,
    scaled,
    pageBox,
    sections
  );

  /*
   * Held apart from the measured scale, which changes on every frame of a
   * resize.
   *
   * Rebuilt inline, each observer callback would rerun the whole render beneath
   * it — sanitisation, migration, every block, and the stylesheet compile — for
   * a page whose content did not change and whose wrapper only needed a new
   * transform. On a large document that is visible jank, and it re-enters any
   * asynchronous block resolver the page has. The canvas holds its page the
   * same way and for the same reason.
   */
  const page = useMemo(
    () => (
      <PageRenderer
        // Spread rather than listed field by field: the bundle owns which
        // inputs describe this site's rendering, and a surface restating them
        // here would silently stop forwarding one it never heard of.
        {...render}
        document={document}
        blocks={entryBlockResolver()}
        siteStyles={siteStyles}
        // Each block's id on its root element, so the links over the page can
        // find the section they stand for. Only where there are links to place.
        nodeAttribute={sections !== undefined}
      />
    ),
    [render, document, siteStyles, sections]
  );

  const size = frameSize(composedHeight * scale, maxHeight);

  return (
    <div
      ref={frame}
      data-slot="page-miniature"
      className={`relative w-full overflow-x-hidden overflow-y-auto overscroll-contain bg-background ${size.frameClass}`}
      style={size.frame}
    >
      {seen ? (
        <div
          ref={pageBox}
          data-slot="page-miniature-page"
          className="relative w-full"
          style={size.page}
        >
          <ScaledPage
            scaledRef={scaled}
            renderWidth={renderWidth}
            scale={scale}
            previewContainer={render.styleContext.previewContainer}
          >
            {page}
          </ScaledPage>
          {sections === undefined || onNavigate === undefined ? null : (
            <SectionLinks
              sections={sections}
              boxes={boxes}
              page={{
                width: renderWidth * scale,
                height: composedHeight * scale,
              }}
              onNavigate={onNavigate}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
