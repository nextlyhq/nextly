/**
 * The site's own layout around the canvas, on a page the site serves: marked
 * as its chrome and made inert, so a click on a site header never edits it,
 * and reported to the host as drawing before or after the page, so the editor
 * can say a site draws its own header or footer.
 *
 * Its own module so the canvas frame stays the entry that draws the frame and
 * wires these parts together.
 *
 * @module canvas/site-chrome
 */
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import * as React from "react";

import { SITE_CHROME_ATTRIBUTE } from "./canvas-frame-sheet";
import { boxInFrameViewport } from "./geometry-dom";

/**
 * Where the site's own layout draws around the page on a page the site
 * serves: something with a box before the page, as a header is, and after it,
 * as a footer is. Read from where each part sits in the site's page against
 * the canvas's mount point, so it holds whatever the site's markup calls it.
 *
 * @experimental Settles with the editor's notices about the site's layout.
 */
export interface SiteChromeDrawn {
  /** The layout draws something before the page. */
  readonly before: boolean;
  /** The layout draws something after the page. */
  readonly after: boolean;
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
 * marked, for the cues drawn over them, and tells `onSiteChrome` where they
 * draw around the page.
 */
export function useSiteChrome(
  page: Document | null,
  mountPoint: HTMLElement | null,
  /** Told where the marked parts draw around the page; see the prop. */
  onSiteChrome: ((drawn: SiteChromeDrawn) => void) | undefined
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
  useReportedSiteChrome(chrome, mountPoint, onSiteChrome);
  return chrome;
}

/** Nothing drawn around the page: the state before any site page arrives. */
const NOTHING_DRAWN: SiteChromeDrawn = { before: false, after: false };

/**
 * Where `elements`, the site's layout around `mountPoint`, draw: only a part
 * with a box counts, so a script or an empty announcer is no header, and a
 * part before the mount point in the page is before the page.
 */
function siteChromeDrawn(
  elements: readonly Element[],
  mountPoint: HTMLElement
): SiteChromeDrawn {
  let before = false;
  let after = false;
  for (const element of elements) {
    const box = boxInFrameViewport(element);
    if (box.width === 0 || box.height === 0) continue;
    // The constant from the node itself, which belongs to the frame's realm.
    const precedes =
      (mountPoint.compareDocumentPosition(element) &
        mountPoint.DOCUMENT_POSITION_PRECEDING) !==
      0;
    if (precedes) before = true;
    else after = true;
  }
  return { before, after };
}

/**
 * Tell the host where the site's layout draws around the page, each time
 * that changes: as its parts arrive or leave, and as one gains or loses its
 * box (a part the site's stylesheet hides until its script runs), and that
 * nothing is drawn once the frame is gone.
 */
function useReportedSiteChrome(
  elements: readonly Element[],
  mountPoint: HTMLElement | null,
  onSiteChrome: ((drawn: SiteChromeDrawn) => void) | undefined
): void {
  const latest = React.useRef(onSiteChrome);
  React.useEffect(() => {
    latest.current = onSiteChrome;
  }, [onSiteChrome]);
  const told = React.useRef<SiteChromeDrawn>(NOTHING_DRAWN);
  const tell = React.useCallback((drawn: SiteChromeDrawn) => {
    if (
      drawn.before === told.current.before &&
      drawn.after === told.current.after
    ) {
      return;
    }
    told.current = drawn;
    latest.current?.(drawn);
  }, []);
  React.useEffect(() => {
    if (mountPoint === null) return undefined;
    const read = (): void => tell(siteChromeDrawn(elements, mountPoint));
    read();
    // From the frame's window, the realm of the elements it observes.
    const Resizes = mountPoint.ownerDocument.defaultView?.ResizeObserver;
    const sizes = Resizes === undefined ? null : new Resizes(read);
    for (const element of elements) sizes?.observe(element);
    return () => sizes?.disconnect();
  }, [elements, mountPoint, tell]);
  // Nothing is drawn once the frame is gone, so a host is never left holding
  // a layout no frame shows.
  React.useEffect(() => () => tell(NOTHING_DRAWN), [tell]);
}
