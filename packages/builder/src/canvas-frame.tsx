"use client";

/**
 * The frame the canvas is drawn in: an iframe the editor owns, at the width of
 * the device being previewed, fitted to the room the panels leave, and as tall
 * as that room at the scale it is painted at. A page taller than the room
 * scrolls inside it, as in a visitor's browser window. A host that states a
 * height gets a frame of that height, fitted both ways.
 *
 * A frame of its own is what makes the canvas a real viewport. Inside it `vw`,
 * a hand-written `@media` rule and the site's container queries answer for the
 * device being previewed rather than for the admin window, and `vh` for the
 * canvas window the author looks through; the site's
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
 * Changing device changes its width, nothing else.
 *
 * **`srcdoc`, never a blob URL.** The admin's content security policy allows
 * frames from its own origin only, which a blob is not; a `srcdoc` document is
 * same-origin with the admin and is not subject to it.
 *
 * **Zoom is a transform.** The frame is laid out at the device's width and
 * painted at the zoom by `transform: scale()`, inside a box sized to the painted
 * result, so the zoom never changes the page's widths, its media queries or its
 * container queries. Only the window's height follows the room, as a browser
 * window's does.
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
import {
  BLANK_PAGE_ATTRIBUTE,
  CANVAS_FRAME_DEFAULTS,
  CANVAS_FRAME_SHEET,
  SITE_CHROME_ATTRIBUTE,
} from "./canvas-frame-sheet";
import {
  frameFillingRegion,
  frameFitScale,
  type FrameSize,
} from "./canvas-width";
import { FIT_ZOOM, usableScale, type CanvasZoom } from "./canvas-zoom";
import { isHTMLElement } from "./dom-kind";
import { frameContentOrigin, pointToHost } from "./geometry";
import {
  CANVAS_FRAME_BOX_ATTRIBUTE,
  CANVAS_LAYER_ATTRIBUTE,
  CHROME_BLEED,
  frameInsetOf,
  framePaintedScale,
  frameViewportOf,
  rootInFrameViewport,
} from "./geometry-dom";
import { BUILDER_CHROME_CLASS, CANVAS_ROOT_CLASS } from "./shell-state";
import { SiteChromeCues } from "./site-chrome-cues";
import { pageSchemeOf } from "./site-ground";

/**
 * Where the frame's page comes from, and where in it the canvas is mounted.
 *
 * Either the editor's own blank document, or a page the SITE serves: a route
 * rendering an empty mount point inside the site's own layouts, so the site's
 * global stylesheets, fonts, header and footer are around the canvas exactly
 * as they are around the published page.
 *
 * @experimental
 */
export type CanvasFrameSource = BlankFrameSource | SiteFrameSource;

/** @experimental */
interface FrameSourceReading {
  /**
   * Whether a document the frame holds is this source's page, ready for the
   * canvas, rather than the blank page a frame shows before its content loads
   * or a site page still starting up.
   */
  readonly ready: (doc: Document) => boolean;
  /** Where in that page the canvas is mounted. */
  readonly mountPoint: (doc: Document) => HTMLElement | null;
}

/**
 * The editor's own document, as `srcdoc`.
 *
 * @experimental
 */
export interface BlankFrameSource extends FrameSourceReading {
  readonly srcDoc: string;
}

/**
 * A page the site serves for the canvas, loaded by URL.
 *
 * The site's own React root runs in that page, so the canvas is portalled in
 * only once the page says it is ready: before the site's root has hydrated, an
 * element the editor added inside it would not match what the server sent.
 *
 * @experimental
 */
export interface SiteFrameSource extends FrameSourceReading {
  /** The page's URL. Only one on the editor's own origin is loaded. */
  readonly src: string;
  /**
   * Whether a loaded document is this route's page at all, ready or not. A
   * page that is not — a "not found" page, a redirect elsewhere — is never
   * going to be, and the frame falls back to the blank page.
   */
  readonly served: (doc: Document) => boolean;
  /**
   * Call `changed` whenever the page's readiness may have changed, until the
   * returned function is called.
   */
  readonly watch: (doc: Document, changed: () => void) => () => void;
}

/**
 * Why the frame shows the blank page rather than the site's:
 * - `other-origin`: the page is on another origin, whose document the editor
 *   can neither reach nor draw into;
 * - `not-served`: the page loaded but is not the canvas route, so the site
 *   has not mounted it;
 * - `not-ready`: the page is the route, but never said it was ready.
 *
 * @experimental
 */
export type CanvasFrameFallback = "other-origin" | "not-served" | "not-ready";

/**
 * How long a page the site serves has to say it is ready, once loaded.
 *
 * Generous, because a site's first page in development compiles on request;
 * a page that has not hydrated by then has failed in its own scripts.
 */
const SITE_PAGE_READY_WITHIN_MS = 20_000;

/** The page's colour scheme, stated on the chrome layer for its marks. */
const PAGE_SCHEME_ATTRIBUTE = "data-nx-page-scheme";

/**
 * A blank, standards-mode page of the editor's own.
 *
 * The doctype is what keeps the page out of quirks mode, where several layout
 * rules differ from the published page's. The page inherits the admin's base
 * URL, as every `srcdoc` document does, so a relative URL in the site's sheet
 * or a block resolves as it does on the admin's origin. Its head opens with
 * the frame's defaults, so their layer is the first the page declares and the
 * lowest, beneath anything loaded into the frame after it.
 *
 * @experimental
 */
export const SRCDOC_FRAME_SOURCE: BlankFrameSource = {
  srcDoc:
    "<!doctype html>" +
    `<html ${BLANK_PAGE_ATTRIBUTE}="">` +
    `<head><meta charset="utf-8"><style>${CANVAS_FRAME_DEFAULTS}</style></head>` +
    "<body></body></html>",
  ready: doc => doc.documentElement.hasAttribute(BLANK_PAGE_ATTRIBUTE),
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
   * The height the page is laid out at, fitted into the region with the width.
   * Left out, the frame fills the region's height at any zoom and a taller
   * page scrolls inside it, as in a visitor's browser window; `vh` then
   * answers for that window. See {@link frameFillingRegion}.
   */
  height?: number;
  /**
   * The zoom: fitting the device's width into the region (both dimensions,
   * where the host states a height), or a chosen scale.
   */
  zoom?: CanvasZoom;
  /** The scale the frame is painted at, reported as it changes. */
  onScale?: (scale: number) => void;
  /** The page's title, for the frame's accessible name. */
  title: string | undefined;
  /**
   * The site's theme the page is shown in, stated as `data-nx-theme` on the
   * frame's root element where a site's dark tokens are switched by it, and,
   * when it is `light` or `dark`, as the iframe element's `color-scheme`, which
   * the frame's `prefers-color-scheme` follows. Left out, the page shows
   * whatever the site applies by default.
   */
  theme?: string;
  /**
   * The language the page's content is written in, as `lang` on the frame's
   * root element: a frame's document does not inherit the language of the
   * document embedding it, so a screen reader would otherwise have none.
   * Left out, the editor document's own language is the nearest statement
   * there is, and the frame takes that.
   */
  lang?: string | undefined;
  /**
   * The direction the page's content is written in, as `dir` on the frame's
   * root element, for the same reason as `lang`. Left out, the editor
   * document's own direction, where it states one.
   */
  dir?: "ltr" | "rtl" | undefined;
  /** The editor's chrome, drawn over the frame in the editor's document. */
  overlay?: React.ReactNode;
  /** The canvas, rendered inside the frame. */
  children?: React.ReactNode;
  /** Where the frame's page comes from. The editor's blank page by default. */
  source?: CanvasFrameSource;
  /**
   * Told why the frame shows the blank page in place of the site's page it
   * was given, and `null` again when it shows that page, so the host can say
   * which the author is looking at.
   */
  onSourceFallback?: (reason: CanvasFrameFallback | null) => void;
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
  height: statedHeight,
  zoom = FIT_ZOOM,
  onScale,
  title,
  overlay,
  children,
  source = SRCDOC_FRAME_SOURCE,
  onSourceFallback,
  className,
  ...markers
}: CanvasFrameProps): React.JSX.Element {
  const stage = React.useRef<HTMLDivElement | null>(null);
  const layer = React.useRef<HTMLDivElement | null>(null);
  const layerContent = React.useRef<HTMLDivElement | null>(null);
  /*
   * The iframe as STATE, through a callback ref, so everything keyed on it
   * runs once it exists. It is created once and kept: see the module docblock.
   */
  const [frame, setFrame] = React.useState<HTMLIFrameElement | null>(null);
  const { shown, pending, refuse } = useShownSource(source, onSourceFallback);
  const { page, mountPoint } = useFramePage(frame, shown, refuse);
  const siteChrome = useSiteChrome(page, mountPoint);

  const region = useRegionSize(stage);
  const { height, scale } = frameLayout(width, statedHeight, region, zoom);
  useReportedScale(scale, onScale);

  const viewport = useFrameViewport(frame, page, width, height);
  useRegistered(frame, scale, viewport);

  usePageMarkers(frame, page, markers);
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
          {...frameDocumentProps(shown, pending)}
          // Laid out at the device's size and painted at the zoom, in the
          // colour scheme of the theme the page is shown in, where one is.
          style={{
            width,
            height,
            transform: `scale(${String(scale)})`,
            ...frameColorScheme(markers.theme),
          }}
        />
        <div
          ref={layer}
          className="nx-canvas-layer"
          {...{ [CANVAS_LAYER_ATTRIBUTE]: "" }}
        >
          <SiteChromeCues
            frame={frame}
            page={page}
            elements={siteChrome}
            scale={scale}
          />
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
 * The iframe ELEMENT's own `color-scheme`, for the theme the page is shown in.
 *
 * A frame's `prefers-color-scheme` follows the used `color-scheme` of the
 * element that embeds it, as the CSS Working Group resolved, so stating the
 * theme here is what can turn a page the site serves, whose own CSS asks
 * `@media (prefers-color-scheme)`, to that theme too; the `data-nx-theme`
 * marker reaches only the site's variables. Driven by the same `theme` the
 * marker is, so the two cannot disagree. Only `light` and `dark` are schemes:
 * any other theme, or none, states nothing, and the frame's sheet leaves the
 * scheme to the device, as a visitor's browser does.
 */
function frameColorScheme(
  theme: string | undefined
): { colorScheme: "light" | "dark" } | Record<string, never> {
  return theme === "light" || theme === "dark" ? { colorScheme: theme } : {};
}

/**
 * What the iframe is given to load its page: the site's page by URL, the
 * editor's blank page as `srcdoc`, or nothing while the choice is pending.
 */
function frameDocumentProps(
  source: CanvasFrameSource,
  pending: boolean
): { src: string } | { srcDoc: string } | Record<string, never> {
  if (pending) return {};
  return "src" in source ? { src: source.src } : { srcDoc: source.srcDoc };
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
 * The height the page is laid out at and the scale it is painted at.
 *
 * A height the host states is laid out as given and fitted both ways; without
 * one, the frame fills the region's height at any zoom and the page scrolls
 * inside it (see `frameFillingRegion`).
 */
function frameLayout(
  width: number,
  statedHeight: number | undefined,
  region: Partial<FrameSize> | undefined,
  zoom: CanvasZoom
): { readonly height: number; readonly scale: number } {
  if (statedHeight === undefined) {
    return frameFillingRegion(width, region, zoom);
  }
  return {
    height: statedHeight,
    scale: frameScale({ width, height: statedHeight }, region, zoom),
  };
}

/**
 * The source the frame shows: the one it was given, or the blank page in its
 * place when a site's page cannot be shown, with the way to say it cannot.
 *
 * A refusal is held against the source it was made for, so a new source is
 * tried afresh. A page on another origin is refused before it is ever loaded:
 * its document could be neither reached nor drawn into, and loading it would
 * still run its scripts.
 *
 * Which origin the editor is on is known only in the browser. Until then —
 * on the server, and in the render that hydrates what the server sent — a
 * site's page is `pending`: neither it nor the blank page is asked for, so
 * the server's markup and the browser's first render agree, and the frame
 * loads once the origin is known.
 */
function useShownSource(
  source: CanvasFrameSource,
  onSourceFallback: CanvasFrameProps["onSourceFallback"]
): {
  shown: CanvasFrameSource;
  pending: boolean;
  refuse: (reason: CanvasFrameFallback) => void;
} {
  const editorOrigin = React.useSyncExternalStore(
    staysTheSame,
    readEditorOrigin,
    noOriginYet
  );
  const pending = "src" in source && editorOrigin === null;
  const [refusal, setRefusal] = React.useState<{
    readonly source: CanvasFrameSource;
    readonly reason: CanvasFrameFallback;
  } | null>(null);
  const reason: CanvasFrameFallback | null =
    "src" in source && !pending && !onOrigin(source.src, editorOrigin)
      ? "other-origin"
      : refusal !== null && refusal.source === source
        ? refusal.reason
        : null;
  const refuse = React.useCallback(
    (refused: CanvasFrameFallback) => setRefusal({ source, reason: refused }),
    [source]
  );
  const latest = React.useRef(onSourceFallback);
  React.useEffect(() => {
    latest.current = onSourceFallback;
  }, [onSourceFallback]);
  const asked = "src" in source;
  React.useEffect(() => {
    // Only a site's page can be fallen back from; the blank page is the
    // fallback, so a host given that has nothing to be told.
    if (asked) latest.current?.(reason);
  }, [asked, reason]);
  return {
    shown: reason === null ? source : SRCDOC_FRAME_SOURCE,
    pending,
    refuse,
  };
}

/** The editor's origin never changes while it runs, so nothing to hear. */
function staysTheSame(): () => void {
  return () => undefined;
}

/** The editor window's own origin, read in the browser. */
function readEditorOrigin(): string | null {
  return typeof location === "undefined" ? null : location.origin;
}

/** On the server, and while hydrating, the origin is not known yet. */
function noOriginYet(): null {
  return null;
}

/**
 * Whether a URL is on the editor's own origin, so the frame's document will be
 * one the editor can reach.
 */
function onOrigin(src: string, origin: string | null): boolean {
  if (origin === null) return false;
  try {
    return new URL(src, origin).origin === origin;
  } catch {
    return false;
  }
}

/** The frame's page, and where in it the canvas mounts, once both exist. */
interface FramePageReading {
  readonly page: Document | null;
  readonly mountPoint: HTMLElement | null;
}

const NO_PAGE: FramePageReading = { page: null, mountPoint: null };

/** The document a frame holds, or `null` where it cannot be reached. */
function documentOf(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

/**
 * The frame's page once it is the source's and ready, with its mount point,
 * or neither before.
 *
 * Held as state and re-read on every `load`, because a frame replaces its
 * document as it loads — the blank page it starts with gives way to the
 * source's, and a reload builds another — and nothing about that renders.
 * Read once on mount as well, for a frame that finished loading before the
 * listener was there to hear it.
 *
 * A site's page is read again whenever it says its readiness changed, since
 * the site's own React root decides when the mount point is there to portal
 * into, and can replace it. One that is not the canvas route, or that never
 * says it is ready, is refused, which shows the blank page in its place.
 */
function useFramePage(
  frame: HTMLIFrameElement | null,
  source: CanvasFrameSource,
  refuse: (reason: CanvasFrameFallback) => void
): FramePageReading {
  const [reading, setReading] = React.useState<FramePageReading>(NO_PAGE);
  useIsomorphicLayoutEffect(() => {
    if (frame === null) return;
    let unwatch: (() => void) | null = null;
    const wait = readinessDeadline(
      frame.ownerDocument.defaultView,
      () => {
        const now = documentOf(frame);
        return !("src" in source && now !== null && source.ready(now));
      },
      () => refuse("not-ready")
    );
    const show = (doc: Document | null): void => {
      const mountPoint =
        doc !== null && source.ready(doc) ? source.mountPoint(doc) : null;
      const next = mountPoint === null ? NO_PAGE : { page: doc, mountPoint };
      setReading(current =>
        current.page === next.page && current.mountPoint === next.mountPoint
          ? current
          : next
      );
    };
    // `loaded` is whether a `load` just reported this document: see
    // `readSitePage`.
    const read = (loaded: boolean): void => {
      unwatch?.();
      unwatch = null;
      if (loaded) wait.disarm();
      const doc = documentOf(frame);
      if ("src" in source) {
        unwatch = readSitePage(doc, loaded, source, { show, wait, refuse });
      } else {
        show(doc);
      }
    };
    const onLoad = (): void => read(true);
    read(false);
    frame.addEventListener("load", onLoad);
    return () => {
      unwatch?.();
      wait.disarm();
      frame.removeEventListener("load", onLoad);
    };
  }, [frame, source, refuse]);
  return reading;
}

/** What reading a site's page in the frame acts through. */
interface SitePageReader {
  readonly show: (doc: Document | null) => void;
  readonly wait: { arm: () => void; disarm: () => void };
  readonly refuse: (reason: CanvasFrameFallback) => void;
}

/**
 * Read the frame's document as a site's page: show it once it is the source's
 * and ready, wait for it within the deadline, or refuse it. Answers the way to
 * stop watching its readiness, when it is the route's page.
 *
 * `loaded` is whether a `load` just reported this document. Read on mount
 * instead, a page at another address is the one an earlier source left behind
 * while this one's request is on its way — never this source's, however ready
 * it looks — and a page that is not the route's may be the empty one every
 * frame starts with, so both are waited for rather than refused.
 */
function readSitePage(
  doc: Document | null,
  loaded: boolean,
  source: SiteFrameSource,
  { show, wait, refuse }: SitePageReader
): (() => void) | null {
  if (!loaded && leftBehind(doc, source.src)) {
    show(null);
    wait.arm();
    return null;
  }
  if (doc === null || !source.served(doc)) {
    show(null);
    if (!loaded) wait.arm();
    else refuse(doc === null ? "other-origin" : "not-served");
    return null;
  }
  // Ready, or waiting for readiness again: the site's root can take the
  // mount point away without the frame loading anything.
  const settle = (): void => {
    show(doc);
    if (source.ready(doc)) wait.disarm();
    else wait.arm();
  };
  const unwatch = source.watch(doc, settle);
  settle();
  return unwatch;
}

/** Whether a document is a page other than the one `src` names. */
function leftBehind(doc: Document | null, src: string): boolean {
  return doc !== null && !isPageAt(doc.URL, doc.baseURI, src);
}

/**
 * Whether a frame's document, at `address`, is the page `src` names: the same
 * address, whatever its fragment, `src` read against the document's `base`
 * when it is relative. The frame's starting page is at no address, so it never
 * is.
 *
 * @internal
 */
export function isPageAt(address: string, base: string, src: string): boolean {
  try {
    const want = new URL(src, base);
    const have = new URL(address);
    return (
      have.origin === want.origin &&
      have.pathname === want.pathname &&
      have.search === want.search
    );
  } catch {
    return false;
  }
}

/**
 * The time a site's page has to be ready for the canvas, running while it is
 * not: armed once and left running when armed again, so waiting that keeps
 * being reported never pushes the deadline back.
 */
function readinessDeadline(
  view: Window | null,
  stillWaiting: () => boolean,
  giveUp: () => void
): { arm: () => void; disarm: () => void } {
  let timer: number | undefined;
  const disarm = (): void => {
    if (timer !== undefined) view?.clearTimeout(timer);
    timer = undefined;
  };
  const arm = (): void => {
    if (timer !== undefined || view === null) return;
    timer = view.setTimeout(() => {
      timer = undefined;
      if (stillWaiting()) giveUp();
    }, SITE_PAGE_READY_WITHIN_MS);
  };
  return { arm, disarm };
}

/** Elements of a site's layout that draw nothing, and so are left alone. */
const UNDRAWN_ELEMENTS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "link",
  "meta",
  "template",
  "noscript",
]);

/**
 * Mark one element of the site's layout as its chrome, inert unless the site
 * made it so itself, remembering which it marked so they can be given back.
 * Answers whether the element is chrome at all: one that draws nothing is not.
 */
function markBeside(
  element: Element,
  seen: Set<Element>,
  marked: Set<Element>
): boolean {
  seen.add(element);
  if (UNDRAWN_ELEMENTS.has(element.localName)) return false;
  element.setAttribute(SITE_CHROME_ATTRIBUTE, "");
  if (element.hasAttribute("inert")) return true;
  element.setAttribute("inert", "");
  marked.add(element);
  return true;
}

/**
 * Forget the chrome the site's layout took away: no longer chrome, its cue
 * goes with it rather than staying over the canvas it uncovered, and it gets
 * back the state it had, since the site may put the same node to use again.
 * An element the site made inert itself stays so. Answers whether anything
 * went.
 */
function dropDetached(
  drawn: Element[],
  ancestors: readonly Element[],
  seen: Set<Element>,
  marked: Set<Element>
): boolean {
  const kept = drawn.filter(
    element =>
      element.parentElement !== null &&
      ancestors.includes(element.parentElement)
  );
  if (kept.length === drawn.length) return false;
  for (const element of drawn) {
    if (kept.includes(element)) continue;
    seen.delete(element);
    element.removeAttribute(SITE_CHROME_ATTRIBUTE);
    if (marked.delete(element)) element.removeAttribute("inert");
  }
  drawn.splice(0, drawn.length, ...kept);
  return true;
}

/**
 * Mark what is new beside the mount point and its ancestors, adding what
 * draws to `drawn`. Answers whether anything was added.
 */
function markArrivals(
  mountPoint: HTMLElement,
  ancestors: readonly Element[],
  drawn: Element[],
  seen: Set<Element>,
  marked: Set<Element>
): boolean {
  let added = false;
  for (const parent of ancestors) {
    for (const beside of Array.from(parent.children)) {
      const onThePath = beside === mountPoint || ancestors.includes(beside);
      if (onThePath || seen.has(beside)) continue;
      if (markBeside(beside, seen, marked)) {
        drawn.push(beside);
        added = true;
      }
    }
  }
  return added;
}

/** The mount point's ancestors below the body, and the body itself. */
function ancestorsUpToBody(
  mountPoint: HTMLElement,
  body: HTMLElement
): Element[] {
  const ancestors: Element[] = [];
  for (
    let node = mountPoint.parentElement;
    node !== null;
    node = node === body ? null : node.parentElement
  ) {
    ancestors.push(node);
  }
  return ancestors;
}

/** No site chrome: the blank page, or a site page not yet ready. */
const NO_CHROME: readonly Element[] = [];

/**
 * Make the site's own layout around the mount point inert and quiet, on a
 * page the site serves: every element beside the mount point and beside each
 * of its ancestors up to the body. The ancestors themselves cannot be inert,
 * since the canvas is inside them.
 *
 * Marked again when an ancestor gains a child, for a site whose layout draws
 * part of itself once its own scripts have run. Answers with the elements it
 * marked, for the cues drawn over them.
 */
function useSiteChrome(
  page: Document | null,
  mountPoint: HTMLElement | null
): readonly Element[] {
  const [chrome, setChrome] = React.useState<readonly Element[]>(NO_CHROME);
  useIsomorphicLayoutEffect(() => {
    if (page === null || mountPoint === null || mountPoint === page.body)
      return;
    const ancestors = ancestorsUpToBody(mountPoint, page.body);
    // Every element looked at, and the ones this marked: an element the site
    // made inert itself stays so when the canvas leaves.
    const seen = new Set<Element>();
    const marked = new Set<Element>();
    const drawn: Element[] = [];
    const mark = (): void => {
      const dropped = dropDetached(drawn, ancestors, seen, marked);
      const added = markArrivals(mountPoint, ancestors, drawn, seen, marked);
      if (dropped || added) setChrome([...drawn]);
    };
    mark();
    const Mutations = page.defaultView?.MutationObserver;
    const arrivals = Mutations === undefined ? null : new Mutations(mark);
    for (const parent of ancestors) {
      arrivals?.observe(parent, { childList: true });
    }
    return () => {
      arrivals?.disconnect();
      for (const element of seen)
        element.removeAttribute(SITE_CHROME_ATTRIBUTE);
      for (const element of marked) element.removeAttribute("inert");
      setChrome(NO_CHROME);
    };
  }, [page, mountPoint]);
  return chrome;
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
 * - The editor chrome class, so the one selector that gives an empty
 *   container its placeholder answers the same in the frame as in the
 *   editor's document. Empty containers always show, so nothing else about
 *   them is stated.
 * - The admin's tokens the page's own chrome reads (see `usePageTokens`).
 * - The page's language and direction: those named, else the page's own, else
 *   the editor document's, so a site page keeps the language it states.
 */
function usePageMarkers(
  frame: HTMLIFrameElement | null,
  page: Document | null,
  { theme, lang, dir }: Pick<CanvasFrameProps, "theme" | "lang" | "dir">
): void {
  usePageTokens(frame, page);
  useIsomorphicLayoutEffect(() => {
    const root = page?.documentElement;
    if (root === undefined) return;
    const editorRoot = frame?.ownerDocument.documentElement;
    root.classList.add(BUILDER_CHROME_CLASS);
    // Named, the editor's theme; otherwise whatever the page itself states,
    // which on a page the site serves is the site's own, live mode.
    stateMarker(root, "data-nx-theme", theme);
    stateMarker(root, "lang", lang, editorRoot?.lang);
    stateMarker(root, "dir", dir, editorRoot?.dir);
  }, [frame, page, theme, lang, dir]);
}

/**
 * What a page's root stated for each marker when the editor began writing
 * one, held only while the editor writes it, so writing none again gives the
 * page's own back.
 */
const PAGE_MARKERS = new WeakMap<Element, Map<string, string | undefined>>();

/**
 * State a marker on a page's root: the one named, else the page's own, else
 * the fallback where the page states none.
 *
 * Only what the editor supplies is written. With nothing to write, the
 * attribute is left alone, so a site that switches its own mode after
 * hydrating keeps it, unless the editor had been writing one: then the page's
 * value from before that comes back, once.
 */
function stateMarker(
  root: Element,
  name: string,
  named: string | undefined,
  fallback?: string
): void {
  let held = PAGE_MARKERS.get(root);
  const own = held?.has(name)
    ? held.get(name)
    : (root.getAttribute(name) ?? undefined);
  const value =
    named ?? (own === undefined || own === "" ? fallback : undefined);
  if (value === undefined || value === "") {
    if (held?.has(name) !== true) return;
    stateAttribute(root, name, own);
    held.delete(name);
    return;
  }
  if (held === undefined) {
    held = new Map();
    PAGE_MARKERS.set(root, held);
  }
  if (!held.has(name)) held.set(name, own);
  root.setAttribute(name, value);
}

/** Set an attribute to a value, or remove it where there is none to state. */
function stateAttribute(
  element: Element,
  name: string,
  value: string | undefined
): void {
  if (value === undefined || value === "") element.removeAttribute(name);
  else element.setAttribute(name, value);
}

/**
 * The admin's tokens the chrome drawn INSIDE the page reads: a Layout region's
 * badge and tag, which are the admin's words on the site's page, and the
 * region's own edge and faded content.
 *
 * The frame's document loads none of the admin's stylesheets, so these are
 * handed in as values, read where the frame sits in the editor. Each set is
 * written onto the region chrome that reads it and nowhere above, because a
 * custom property inherits: on the page's root, the admin's `--font-sans` or
 * `--radius-sm` would replace a site's own value of the same name across the
 * whole page. The region box takes only the editor's own names, since what it
 * holds is the site's content.
 */
const PAGE_CHROME_TOKENS: readonly {
  readonly selector: string;
  readonly tokens: readonly string[];
}[] = [
  {
    selector: ".nx-canvas-region",
    tokens: ["--nx-builder-border", "--nx-builder-accent"],
  },
  {
    selector: `.nx-canvas-region__content, [${SITE_CHROME_ATTRIBUTE}]`,
    tokens: ["--nx-builder-region-opacity"],
  },
  {
    // A collection list's note to its author holds the admin's words alone,
    // so it may take the admin's face as well as its colours.
    selector: "[data-nx-list-diagnostic]",
    tokens: [
      // The focus ring of the note's one action.
      "--nx-builder-select",
      "--nx-builder-warning",
      "--nx-builder-danger",
      "--nx-builder-surface-raised",
      "--nx-builder-text",
      "--nx-builder-scheme",
      "--font-sans",
      "--radius-sm",
    ],
  },
  {
    // A list drawing its empty state holds the site's content, so its tag
    // reads only the editor's own names.
    selector: "[data-nx-list-shows]",
    tokens: ["--nx-builder-select", "--nx-builder-select-text"],
  },
  {
    selector: ".nx-canvas-region__mark",
    tokens: [
      "--nx-builder-border",
      "--nx-builder-surface-raised",
      "--nx-builder-text",
      "--nx-builder-text-muted",
      "--nx-builder-accent",
      "--nx-builder-scheme",
      "--radius-sm",
      "--text-xs",
      "--font-sans",
    ],
  },
];

/** Marks the frame's sheet that carries the handed tokens. */
const PAGE_TOKENS_ATTRIBUTE = "data-nx-page-chrome-tokens";

/** The page's sheet for the handed tokens, made the first time it is asked. */
function tokenSheet(page: Document): CSSStyleSheet | null {
  const found = page.head.querySelector<HTMLStyleElement>(
    `style[${PAGE_TOKENS_ATTRIBUTE}]`
  );
  if (found !== null) return found.sheet;
  const holder = page.createElement("style");
  holder.setAttribute(PAGE_TOKENS_ATTRIBUTE, "");
  page.head.append(holder);
  return holder.sheet;
}

/**
 * One rule of the token sheet: `selector`, declaring each of `tokens` that
 * has a value where the frame sits.
 */
function writeTokenRule(
  sheet: CSSStyleSheet,
  from: CSSStyleDeclaration,
  { selector, tokens }: (typeof PAGE_CHROME_TOKENS)[number]
): void {
  const rule = sheet.cssRules[
    sheet.insertRule(`${selector} {}`, sheet.cssRules.length)
  ] as CSSStyleRule | undefined;
  if (rule?.style === undefined) return;
  for (const token of tokens) {
    const value = from.getPropertyValue(token).trim();
    if (value !== "") rule.style.setProperty(token, value);
  }
}

/**
 * Write each token's value where the frame sits onto the region chrome that
 * reads it, through the style rules of one sheet of the editor's own. Set
 * through the rules' declarations rather than as text, so a value is taken
 * as a value and can never close the rule it sits in.
 */
function handTokens(frame: HTMLIFrameElement, page: Document): void {
  const view = frame.ownerDocument.defaultView;
  const sheet = tokenSheet(page);
  if (view === null || sheet === null) return;
  const from = view.getComputedStyle(frame);
  while (sheet.cssRules.length > 0) sheet.deleteRule(0);
  for (const scope of PAGE_CHROME_TOKENS) writeTokenRule(sheet, from, scope);
}

/**
 * Hand the page's region chrome the admin's tokens it reads, and again
 * whenever the admin's theme changes: the admin switches it by a class or an
 * attribute on an element around the editor (its root, its body or its own
 * wrapper), or the system's contrast preference
 * moves the border and muted text.
 */
function usePageTokens(
  frame: HTMLIFrameElement | null,
  page: Document | null
): void {
  useIsomorphicLayoutEffect(() => {
    const host = frame?.ownerDocument;
    const view = host?.defaultView;
    if (frame == null || page == null || host == null || view == null) return;
    const hand = () => handTokens(frame, page);
    hand();
    const watch = new view.MutationObserver(hand);
    /*
     * Every ancestor of the frame, because only an ancestor's class or style
     * can change what the frame inherits, and the admin's theme provider
     * switches it on its own wrapper rather than on the root or the body.
     * Each is watched alone rather than the whole document's subtree, which
     * would re-read the tokens for every class change anywhere in the admin.
     */
    for (
      let target: Element | null = frame.parentElement;
      target !== null;
      target = target.parentElement
    ) {
      watch.observe(target, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });
    }
    // Absent where there is no media to query, as in a test document.
    const contrast = view.matchMedia?.("(prefers-contrast: more)");
    contrast?.addEventListener("change", hand);
    return () => {
      watch.disconnect();
      contrast?.removeEventListener("change", hand);
      page.head.querySelector(`style[${PAGE_TOKENS_ATTRIBUTE}]`)?.remove();
    };
  }, [frame, page]);
}

/** What the layer placement needs, once every part of it exists. */
interface LayerParts {
  readonly frame: HTMLIFrameElement;
  readonly box: HTMLDivElement;
  readonly content: HTMLDivElement;
  readonly mountPoint: HTMLElement;
  readonly view: Window & typeof globalThis;
}

/** The layer placement's parts, or `null` while any is still missing. */
function layerParts(
  frame: HTMLIFrameElement | null,
  page: Document | null,
  mountPoint: HTMLElement | null,
  box: HTMLDivElement | null,
  content: HTMLDivElement | null
): LayerParts | null {
  const view = page?.defaultView ?? null;
  if (frame === null || mountPoint === null || view === null) return null;
  if (box === null || content === null) return null;
  return { frame, box, content, mountPoint, view };
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
    const parts = layerParts(
      frame,
      page,
      mountPoint,
      layer.current,
      layerContent.current
    );
    if (parts === null) return;
    const { box, content, view } = parts;
    let root: HTMLElement | null = null;
    let sizes: ResizeObserver | null = null;
    let restyled: MutationObserver | null = null;

    const place = (): void => {
      /*
       * The painted scale, measured, rather than the one asked for: the two
       * are the same number by construction, and the mapping every piece of
       * chrome uses reads the measured one.
       */
      const painted = framePaintedScale(parts.frame);
      const origin = frameContentOrigin(
        { x: 0, y: 0 },
        frameInsetOf(parts.frame),
        painted
      );
      const viewport = frameViewportOf(parts.frame);
      // The viewport, and CHROME_BLEED past it on every side, where a ring
      // outside a block flush with the page's edge is drawn; the content is
      // moved back by as much, so nothing drawn in it moves.
      box.style.left = `${String(origin.x - CHROME_BLEED)}px`;
      box.style.top = `${String(origin.y - CHROME_BLEED)}px`;
      box.style.width = `${String((viewport?.width ?? 0) * painted + 2 * CHROME_BLEED)}px`;
      box.style.height = `${String((viewport?.height ?? 0) * painted + 2 * CHROME_BLEED)}px`;
      if (root === null) {
        content.hidden = true;
        return;
      }
      content.hidden = false;
      // The scheme the page is drawn in, so the marks over it take the hue for
      // its ground rather than for the admin's theme.
      // Judged from the ground the page paints, not from its `color-scheme`:
      // a site offering a dark set declares `light dark` while showing a
      // light page, and the dark hues are faint there.
      box.setAttribute(PAGE_SCHEME_ATTRIBUTE, pageSchemeOf(root));
      const at = pointToHost(rootInFrameViewport(root), {
        origin: { x: 0, y: 0 },
        scale: painted,
      });
      content.style.transform = `translate(${String(at.x + CHROME_BLEED)}px, ${String(at.y + CHROME_BLEED)}px)`;
      content.style.width = `${String(root.offsetWidth * painted)}px`;
      content.style.height = `${String(root.offsetHeight * painted)}px`;
    };

    const find = (): void => {
      const found = parts.mountPoint.querySelector(`.${CANVAS_ROOT_CLASS}`);
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
          // The root can MOVE without changing size, when what is above it
          // in a site's own layout grows — a banner, a header image loading —
          // and only the page's own size says so.
          sizes.observe(view.document.documentElement);
          if (view.document.body !== null) sizes.observe(view.document.body);
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
    arrivals?.observe(parts.mountPoint, { childList: true });
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
