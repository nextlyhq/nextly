"use client";

/**
 * The frame the canvas is drawn in: an iframe the editor owns, at the width
 * and height of the device being previewed, scaled to fit the room the panels
 * leave.
 *
 * A frame of its own is what makes the canvas a real viewport. Inside it `vw`,
 * `vh`, a hand-written `@media` rule and the site's container queries answer
 * for the device being previewed rather than for the admin window, the site's
 * sheet goes in exactly as it is published, and nothing of the admin's theme or
 * stylesheet reaches the page — nor anything of the page's the admin.
 *
 * **One React tree.** The page is PORTALLED into the frame's body: the editor's
 * state, its store and every hook stay where they are, and only the elements
 * are created in the frame's document. React delivers events from the portal
 * along the component tree, so the canvas's handlers run as they always did.
 *
 * **One iframe element for the life of the editor.** It is never re-keyed: a
 * new iframe starts from a blank page before its content loads — visibly in
 * Firefox — and everything portalled into the old one is lost with it.
 * Changing device changes its width and height, nothing else.
 *
 * **`srcdoc`, never a blob URL.** The admin's content security policy allows
 * frames from its own origin only, which a blob is not; a `srcdoc` document is
 * same-origin with the admin and is not subject to it.
 *
 * **Zoom is a transform.** The frame is laid out at the device's size and
 * painted at the zoom by `transform: scale()`, inside a box sized to the painted
 * result, so the page's layout never depends on how much room the editor has.
 *
 * **Chrome is drawn over it, in the editor's document.** The layer above the
 * frame is clipped to the frame's viewport, its content box is laid over the
 * canvas root and moved with the frame's scroll, and the chrome in it is
 * placed by `overlaySpaceOf` (`geometry-dom.ts`) at its own size rather than
 * scaled with the page.
 *
 * @module canvas-frame
 */

import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import { cn } from "@nextlyhq/ui/utils";
import * as React from "react";
import { createPortal } from "react-dom";

import {
  CanvasFrameProvider,
  useFrameRegistration,
  type CanvasFrame as CanvasFrameReading,
} from "./canvas-frame-context";
import { CANVAS_FRAME_SHEET } from "./canvas-frame-sheet";
import { frameFitScale, previewHeight, type FrameSize } from "./canvas-width";
import { FIT_ZOOM, usableScale, type CanvasZoom } from "./canvas-zoom";
import { isHTMLElement } from "./dom-kind";
import { frameContentOrigin, pointToHost } from "./geometry";
import {
  CANVAS_FRAME_BOX_ATTRIBUTE,
  CANVAS_LAYER_ATTRIBUTE,
  frameInsetOf,
  framePaintedScale,
  frameViewportOf,
  rootInFrameViewport,
} from "./geometry-dom";
import {
  BUILDER_CHROME_CLASS,
  CANVAS_ROOT_CLASS,
  EMPTY_ELEMENTS_ATTRIBUTE,
} from "./shell-state";

/**
 * Where the frame's page comes from, and where in it the canvas is mounted.
 *
 * A seam rather than a constant, because the page will not always be a blank
 * document: a site can serve the canvas inside its own layout, and then the
 * frame loads that route and the canvas mounts at a point the route marks.
 * Only the `srcdoc` source exists today.
 *
 * @experimental
 */
export interface CanvasFrameSource {
  /** The frame's document, as `srcdoc`. */
  readonly srcDoc: string;
  /**
   * Whether a document the frame holds is this source's page, rather than the
   * blank page a frame shows before its content loads.
   */
  readonly ready: (doc: Document) => boolean;
  /** Where in that page the canvas is mounted. */
  readonly mountPoint: (doc: Document) => HTMLElement | null;
}

/** The page's colour scheme, stated on the chrome layer for its marks. */
const PAGE_SCHEME_ATTRIBUTE = "data-nx-page-scheme";

/** The attribute the `srcdoc` page carries, which the blank page does not. */
const FRAME_DOCUMENT_ATTRIBUTE = "data-nx-canvas-frame";

/**
 * A blank, standards-mode page of the editor's own.
 *
 * The doctype is what keeps the page out of quirks mode, where several layout
 * rules differ from the published page's. The page inherits the admin's base
 * URL, as every `srcdoc` document does, so a relative URL in the site's sheet
 * or a block resolves as it does on the admin's origin.
 *
 * @experimental
 */
export const SRCDOC_FRAME_SOURCE: CanvasFrameSource = {
  srcDoc:
    "<!doctype html>" +
    `<html ${FRAME_DOCUMENT_ATTRIBUTE}="">` +
    '<head><meta charset="utf-8"></head><body></body></html>',
  ready: doc => doc.documentElement.hasAttribute(FRAME_DOCUMENT_ATTRIBUTE),
  mountPoint: doc => doc.body,
};

/** What the frame's accessible name begins with. */
export const CANVAS_FRAME_TITLE_PREFIX = "Page canvas";

/**
 * The frame's accessible name, for the page it shows.
 *
 * A screen reader moving into the frame announces this, so it names the page
 * being edited rather than the editor.
 */
export function canvasFrameTitle(pageTitle: string | undefined): string {
  const title = pageTitle?.trim() ?? "";
  return `${CANVAS_FRAME_TITLE_PREFIX}: ${title === "" ? "Untitled" : title}`;
}

/** @experimental */
export interface CanvasFrameProps {
  /** The width the page is laid out at: the device being previewed. */
  width: number;
  /**
   * The height the page is laid out at. Derived from the width when left out,
   * by {@link previewHeight}, so `vh` follows the device and never the room the
   * panels leave.
   */
  height?: number;
  /** The zoom: fitting both dimensions into the region, or a chosen scale. */
  zoom?: CanvasZoom;
  /** The scale the frame is painted at, reported as it changes. */
  onScale?: (scale: number) => void;
  /** The page's title, for the frame's accessible name. */
  title: string | undefined;
  /**
   * The site's theme the page is shown in, stated as `data-nx-theme` on the
   * frame's root element where a site's dark tokens are switched by it. Left
   * out, the page shows whatever the site applies by default.
   */
  theme?: string;
  /** Whether empty containers draw their placeholder. Shown by default. */
  showEmptyElements?: boolean;
  /** The editor's chrome, drawn over the frame in the editor's document. */
  overlay?: React.ReactNode;
  /** The canvas, rendered inside the frame. */
  children?: React.ReactNode;
  /** Where the frame's page comes from. The editor's blank page by default. */
  source?: CanvasFrameSource;
  className?: string;
}

/**
 * What `useCanvasFrame` answers with, under the component's name, so a host
 * importing one `CanvasFrame` has both the component and what it provides.
 *
 * @experimental
 */
export type CanvasFrame = CanvasFrameReading;

/**
 * The canvas's frame.
 *
 * Registers its iframe with the `CanvasFrameProvider` above it, so the panels,
 * the toolbar and the keys outside the canvas see the frame too. With no
 * provider above that waits for one, it provides for itself, which is enough
 * for the canvas and the chrome drawn over it.
 *
 * @experimental
 */
export function CanvasFrame(props: CanvasFrameProps): React.JSX.Element {
  const registration = useFrameRegistration();
  if (registration !== null) return <FramedCanvas {...props} />;
  return (
    <CanvasFrameProvider>
      <FramedCanvas {...props} />
    </CanvasFrameProvider>
  );
}

function FramedCanvas({
  width,
  height = previewHeight(width),
  zoom = FIT_ZOOM,
  onScale,
  title,
  theme,
  showEmptyElements = true,
  overlay,
  children,
  source = SRCDOC_FRAME_SOURCE,
  className,
}: CanvasFrameProps): React.JSX.Element {
  const stage = React.useRef<HTMLDivElement | null>(null);
  const layer = React.useRef<HTMLDivElement | null>(null);
  const layerContent = React.useRef<HTMLDivElement | null>(null);
  /*
   * The iframe as STATE, through a callback ref, so everything keyed on it
   * runs once it exists. It is created once and kept: see the module docblock.
   */
  const [frame, setFrame] = React.useState<HTMLIFrameElement | null>(null);
  const page = useFramePage(frame, source);
  const mountPoint = page === null ? null : source.mountPoint(page);

  const region = useRegionSize(stage);
  const size: FrameSize = { width, height };
  const scale = frameScale(size, region, zoom);
  useReportedScale(scale, onScale);

  const viewport = useFrameViewport(frame, page, width, height);
  useRegistered(frame, scale, viewport);

  usePageMarkers(page, theme, showEmptyElements);
  useLayerPlacement(frame, page, mountPoint, layer, layerContent, scale);

  return (
    <div ref={stage} className={cn("nx-canvas-stage", className)}>
      <div
        className="nx-canvas-frame"
        {...{ [CANVAS_FRAME_BOX_ATTRIBUTE]: "" }}
        // The PAINTED size, so the region around it scrolls exactly as far as
        // the frame reaches and centres it when it is smaller.
        style={{ width: width * scale, height: height * scale }}
      >
        <iframe
          ref={setFrame}
          className="nx-canvas-frame__page"
          title={canvasFrameTitle(title)}
          srcDoc={source.srcDoc}
          // Laid out at the device's size and painted at the zoom.
          style={{ width, height, transform: `scale(${String(scale)})` }}
        />
        <div
          ref={layer}
          className="nx-canvas-layer"
          {...{ [CANVAS_LAYER_ATTRIBUTE]: "" }}
        >
          <div ref={layerContent} className="nx-canvas-layer__content">
            {overlay}
          </div>
        </div>
      </div>
      <FramePage mountPoint={mountPoint}>{children}</FramePage>
    </div>
  );
}

/**
 * The page, with the frame's own sheet, portalled into the frame once its
 * page has loaded, and nothing before.
 */
function FramePage({
  mountPoint,
  children,
}: {
  mountPoint: HTMLElement | null;
  children?: React.ReactNode;
}): React.JSX.Element | null {
  if (mountPoint === null) return null;
  return createPortal(
    <>
      <style>{CANVAS_FRAME_SHEET}</style>
      {children}
    </>,
    mountPoint
  );
}

/**
 * Hand the frame, and how it is drawn, up to the provider above, for
 * everything outside the canvas.
 */
function useRegistered(
  frame: HTMLIFrameElement | null,
  scale: number,
  viewport: FrameSize | null
): void {
  const registration = useFrameRegistration();
  useIsomorphicLayoutEffect(() => {
    if (registration === null || frame === null) return;
    registration.register(frame);
    return () => registration.register(null);
  }, [registration, frame]);
  useIsomorphicLayoutEffect(() => {
    registration?.report({ scale, viewport });
  }, [registration, scale, viewport]);
}

/**
 * The scale the frame is painted at: the chosen one, or the one fitting both
 * of its dimensions into the region.
 *
 * A chosen scale this canvas cannot paint at falls back to fitting, for the
 * reason `usableScale` gives.
 */
function frameScale(
  size: FrameSize,
  region: Partial<FrameSize> | undefined,
  zoom: CanvasZoom
): number {
  if (zoom.kind === "fixed") {
    const chosen = usableScale(zoom.scale);
    if (chosen !== null) return chosen;
  }
  return frameFitScale(size, region ?? {});
}

/**
 * The frame's page once it is the source's, or `null` before.
 *
 * Held as state and re-read on every `load`, because a frame replaces its
 * document as it loads — the blank page it starts with gives way to the
 * source's, and a reload builds another — and nothing about that renders.
 * Read once on mount as well, for a frame that finished loading before the
 * listener was there to hear it.
 */
function useFramePage(
  frame: HTMLIFrameElement | null,
  source: CanvasFrameSource
): Document | null {
  const [page, setPage] = React.useState<Document | null>(null);
  useIsomorphicLayoutEffect(() => {
    if (frame === null) return;
    const read = (): void => {
      const doc = frame.contentDocument;
      setPage(doc !== null && source.ready(doc) ? doc : null);
    };
    read();
    frame.addEventListener("load", read);
    return () => frame.removeEventListener("load", read);
  }, [frame, source]);
  return page;
}

/**
 * The nearest ancestor that lays the stage out, skipping boxless wrappers.
 *
 * A `display: contents` element — the block menu's trigger wraps the canvas in
 * one — generates no box, and an observer on it reports a size of zero.
 */
function layoutRegionOf(element: HTMLElement | null): HTMLElement | null {
  const view = element?.ownerDocument.defaultView ?? null;
  if (view === null) return null;
  for (
    let node = element?.parentElement ?? null;
    node !== null;
    node = node.parentElement
  ) {
    if (view.getComputedStyle(node).display !== "contents") return node;
  }
  return null;
}

/**
 * The room the region gives the frame: its CONTENT box, padding excluded, or
 * `undefined` until it has been measured.
 *
 * The region rather than the stage, because the stage grows with a frame
 * zoomed past the region and the fit would then be measured against a box the
 * frame itself made larger.
 */
function useRegionSize(
  stage: React.RefObject<HTMLElement | null>
): FrameSize | undefined {
  const [size, setSize] = React.useState<FrameSize | undefined>(undefined);
  React.useEffect(() => {
    const region = layoutRegionOf(stage.current);
    // From the region's own window, the realm of what it observes.
    const Sizes = region?.ownerDocument.defaultView?.ResizeObserver;
    if (region === null || typeof Sizes !== "function") return;
    const observer = new Sizes(entries => {
      const box = entries[0]?.contentRect;
      if (box === undefined) return;
      setSize(current =>
        current?.width === box.width && current.height === box.height
          ? current
          : { width: box.width, height: box.height }
      );
    });
    observer.observe(region);
    return () => observer.disconnect();
  }, [stage]);
  return size;
}

/**
 * Report the scale to the host, keyed on the value and on whether anyone is
 * listening, never on the reporter's identity: a host passing an inline
 * setter would otherwise re-report on every render.
 */
function useReportedScale(
  scale: number,
  onScale: ((scale: number) => void) | undefined
): void {
  const latest = React.useRef(onScale);
  React.useEffect(() => {
    latest.current = onScale;
  }, [onScale]);
  const listening = onScale !== undefined;
  React.useEffect(() => {
    latest.current?.(scale);
  }, [listening, scale]);
}

/**
 * The frame's viewport in its own pixels, read again when the page, the
 * frame's size or the window's resize changes it.
 */
function useFrameViewport(
  frame: HTMLIFrameElement | null,
  page: Document | null,
  width: number,
  height: number
): FrameSize | null {
  const [viewport, setViewport] = React.useState<FrameSize | null>(null);
  useIsomorphicLayoutEffect(() => {
    if (frame === null || page === null) {
      setViewport(null);
      return;
    }
    const read = (): void => {
      const next = frameViewportOf(frame);
      setViewport(current =>
        current !== null &&
        next !== null &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next
      );
    };
    read();
    const view = page.defaultView;
    view?.addEventListener("resize", read);
    return () => view?.removeEventListener("resize", read);
  }, [frame, page, width, height]);
  return viewport;
}

/**
 * The markers on the frame's root element that rules inside the frame key on.
 *
 * - The site's theme, where a site's dark tokens are switched by it.
 * - The editor chrome class with the shell's empty-elements preference, so
 *   the one selector that decides whether an empty container shows its
 *   placeholder answers the same in the frame as in the editor's document.
 */
function usePageMarkers(
  page: Document | null,
  theme: string | undefined,
  showEmptyElements: boolean
): void {
  useIsomorphicLayoutEffect(() => {
    const root = page?.documentElement;
    if (root === undefined) return;
    root.classList.add(BUILDER_CHROME_CLASS);
    if (theme === undefined) root.removeAttribute("data-nx-theme");
    else root.setAttribute("data-nx-theme", theme);
    if (showEmptyElements) root.removeAttribute(EMPTY_ELEMENTS_ATTRIBUTE);
    else root.setAttribute(EMPTY_ELEMENTS_ATTRIBUTE, "hidden");
  }, [page, theme, showEmptyElements]);
}

/**
 * Keep the chrome layer over the frame's viewport, and its content box over
 * the canvas root.
 *
 * Written to the elements' styles directly rather than through state: the
 * frame's scroll moves the root on every frame of a scroll, and a render per
 * scroll event would lag the chrome behind the page it marks.
 */
function useLayerPlacement(
  frame: HTMLIFrameElement | null,
  page: Document | null,
  mountPoint: HTMLElement | null,
  layer: React.RefObject<HTMLDivElement | null>,
  layerContent: React.RefObject<HTMLDivElement | null>,
  scale: number
): void {
  useIsomorphicLayoutEffect(() => {
    const box = layer.current;
    const content = layerContent.current;
    const view = page?.defaultView;
    if (
      frame === null ||
      box === null ||
      content === null ||
      mountPoint === null ||
      view === null ||
      view === undefined
    ) {
      return;
    }
    let root: HTMLElement | null = null;
    let sizes: ResizeObserver | null = null;
    let restyled: MutationObserver | null = null;

    const place = (): void => {
      /*
       * The painted scale, measured, rather than the one asked for: the two
       * are the same number by construction, and the mapping every piece of
       * chrome uses reads the measured one.
       */
      const painted = framePaintedScale(frame);
      const origin = frameContentOrigin(
        { x: 0, y: 0 },
        frameInsetOf(frame),
        painted
      );
      const viewport = frameViewportOf(frame);
      box.style.left = `${String(origin.x)}px`;
      box.style.top = `${String(origin.y)}px`;
      box.style.width = `${String((viewport?.width ?? 0) * painted)}px`;
      box.style.height = `${String((viewport?.height ?? 0) * painted)}px`;
      if (root === null) {
        content.hidden = true;
        return;
      }
      content.hidden = false;
      // The scheme the page is drawn in, so the marks over it take the hue for
      // its ground rather than for the admin's theme.
      const scheme = view.getComputedStyle(root).colorScheme;
      box.setAttribute(
        PAGE_SCHEME_ATTRIBUTE,
        scheme.includes("dark") ? "dark" : "light"
      );
      const at = pointToHost(rootInFrameViewport(root), {
        origin: { x: 0, y: 0 },
        scale: painted,
      });
      content.style.transform = `translate(${String(at.x)}px, ${String(at.y)}px)`;
      content.style.width = `${String(root.offsetWidth * painted)}px`;
      content.style.height = `${String(root.offsetHeight * painted)}px`;
    };

    const find = (): void => {
      const found = mountPoint.querySelector(`.${CANVAS_ROOT_CLASS}`);
      const next = isHTMLElement(found) ? found : null;
      if (next !== root) {
        sizes?.disconnect();
        restyled?.disconnect();
        sizes = null;
        restyled = null;
        root = next;
        // From the frame's window, the realm of the root it observes.
        const Sizes = view.ResizeObserver;
        if (root !== null && typeof Sizes === "function") {
          sizes = new Sizes(place);
          sizes.observe(root);
        }
        // The root's own attributes say how the site's dark mode applies.
        if (root !== null && Mutations !== undefined) {
          restyled = new Mutations(place);
          restyled.observe(root, { attributes: true });
        }
      }
      place();
    };

    const Mutations =
      typeof view.MutationObserver === "function"
        ? view.MutationObserver
        : undefined;
    find();
    const arrivals = Mutations === undefined ? null : new Mutations(find);
    arrivals?.observe(mountPoint, { childList: true });
    // A site darkening with the system changes the page's scheme with nothing
    // else changing.
    const systemScheme = view.matchMedia?.("(prefers-color-scheme: dark)");
    systemScheme?.addEventListener("change", place);
    // A viewport's scroll is dispatched at its document.
    page?.addEventListener("scroll", place, { passive: true });
    view.addEventListener("resize", place);
    return () => {
      arrivals?.disconnect();
      sizes?.disconnect();
      restyled?.disconnect();
      systemScheme?.removeEventListener("change", place);
      page?.removeEventListener("scroll", place);
      view.removeEventListener("resize", place);
    };
  }, [frame, page, mountPoint, layer, layerContent, scale]);
}
