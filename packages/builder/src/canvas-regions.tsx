/**
 * The regions of a page's Layout, drawn on the canvas around the page and
 * locked.
 *
 * A Layout's header and footer are what a visitor sees around the page, so the
 * canvas draws them, from the PUBLISHED Layout and components the host hands
 * over. They are not the page's to edit: nothing in them can be selected,
 * dragged onto or typed into, and a click shows where they come from, with a
 * way to edit the Layout in a new tab so the page's own undo history survives.
 *
 * Drawn as part of the canvas's rendered subtree, inside the canvas root, so
 * whatever surface the canvas lives on (today the admin page, later the
 * editor's own frame) carries them with the page.
 *
 * What says so never covers the region's content: a small lock outside the
 * region, at the edge it shares with the page, which widens into a short
 * badge on hover or focus and opens the full tag beside it on a click
 * (`canvas-region-placement` has where, and when it flips inside).
 *
 * @module canvas-regions
 */
import type {
  BlockDocument,
  DefinitionsById,
  RegionArea,
} from "@nextlyhq/blocks-engine";
import {
  PageRenderer,
  type PageRendererProps,
  type PartSheet,
} from "@nextlyhq/blocks-react";
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import { Lock } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";

import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import {
  inputDocuments,
  useCanvasFrame,
  type CanvasFrame,
} from "./canvas-frame-context";
import {
  REGION_MARK_INSET,
  regionMarkLeft,
  regionMarkPlacement,
  type RegionMarkPlacement,
} from "./canvas-region-placement";
import {
  canvasContentRect,
  canvasRootFrom,
  onScreenBandOf,
  screenScrollers,
  scrollEventTarget,
} from "./geometry-dom";
import { CANVAS_ROOT_CLASS } from "./shell-state";

/** One region of the page's Layout, as the host hands it to the canvas. */
export interface CanvasRegion {
  /** Which area: drawn before the page for a header, after it for a footer. */
  readonly area: RegionArea;
  /** The region's document: one instance of the component filling the area. */
  readonly document: BlockDocument;
  /** The PUBLISHED definitions that document reaches, nested ones included. */
  readonly definitions?: DefinitionsById;
  /** What the region is and where it comes from: "Header, from Layout Main". */
  readonly label: string;
  /** A short form shown on hover or focus: "Header · from Layout". */
  readonly badge: string;
  /**
   * The way to edit the Layout, for someone who may update it: a link that
   * opens in a new tab. Absent for anyone else, who gets the label alone.
   */
  readonly edit?: {
    readonly href: string;
    /** The visible text, "Edit Layout ↗". */
    readonly text: string;
    /** The accessible name, which says it opens in a new tab. */
    readonly name: string;
  };
  /** Which part has changes a visitor does not see yet, when one does. */
  readonly note?: string;
}

/** The attribute naming a drawn region's area, for a host scrolling to it. */
export const REGION_ATTRIBUTE = "data-nx-region";

/**
 * How a region's mark is shown: the lock alone at rest, widened into its
 * badge while the pointer or focus is on the region, and with the tag open
 * beside it after a click, Enter or Space.
 */
type MarkState = "rest" | "hover" | "open";

/**
 * One locked region on the canvas.
 *
 * Its content is `inert`: the region's links and forms cannot be followed or
 * focused, and the pointer falls through to the region itself, which answers a
 * click by opening its tag. The lock is the region's one focus stop, named
 * for the region and that it is locked; Enter or Space opens the tag, Tab
 * then reaches the Edit link beside it, and Escape closes it and returns focus
 * to the lock. The tag also closes on a click anywhere else, when focus leaves
 * the region, and when the canvas selects something else. Nothing traps focus.
 *
 * Marked as chrome, so the canvas's selection, hit-testing and link guard all
 * leave it alone: it is not part of the document being edited.
 */
export function CanvasRegionFrame({
  region,
  rendered,
  sheet,
  selection,
}: {
  region: CanvasRegion;
  /** The canvas's own renderer inputs, less what belongs to the page alone. */
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  /** How this part treats the site sheet, and the scope it compiles under. */
  sheet: PartSheet;
  /** The canvas's selection, which closes the tag when it changes. */
  selection?: readonly string[];
}): JSX.Element {
  const [state, setState] = useState<MarkState>("rest");
  const frame = useRef<HTMLDivElement | null>(null);
  const lock = useRef<HTMLButtonElement | null>(null);
  const mark = useRef<HTMLDivElement | null>(null);
  const tagId = useId();
  const open = state === "open";
  const canvas = useCanvasFrame();
  const place = useMarkPlace(frame, mark, region.area, canvas, state);
  const handlers = useRegionHandlers(setState, frame, lock, open);
  useClosedOnOutsidePress(open, frame, canvas, handlers.rest);
  useClosedOnSelection(selection, handlers.rest);

  return (
    <div
      ref={frame}
      className="nx-canvas-region"
      {...{ [CHROME_ATTRIBUTE]: "", [REGION_ATTRIBUTE]: region.area }}
      role="group"
      aria-label={region.label}
      // Focusable only by a host's call, as Layers does to show the region:
      // its focus is handed to the lock, the one stop a key reaches.
      tabIndex={-1}
      data-state={state}
      {...handlers.frame}
    >
      <div className="nx-canvas-region__content" inert>
        <RegionContent region={region} rendered={rendered} sheet={sheet} />
      </div>
      <div
        ref={mark}
        className="nx-canvas-region__mark"
        data-placement={place.placement}
        style={{ left: place.left }}
      >
        <div className="nx-canvas-region__mark-body">
          <button
            ref={lock}
            type="button"
            className="nx-canvas-region__lock"
            aria-label={`${region.label}, locked`}
            aria-expanded={open}
            aria-controls={open ? tagId : undefined}
            {...handlers.lock}
          >
            <Lock size={12} aria-hidden="true" />
            <span className="nx-canvas-region__badge" aria-hidden="true">
              {region.badge}
            </span>
          </button>
          {open ? <RegionTag region={region} id={tagId} /> : null}
        </div>
      </div>
    </div>
  );
}

/** The region's own document, drawn with the canvas's inputs. */
function RegionContent({
  region,
  rendered,
  sheet,
}: {
  region: CanvasRegion;
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  sheet: PartSheet;
}): JSX.Element {
  const {
    styles: _pageStyles,
    definitions: _pageDefinitions,
    ...shared
  } = rendered ?? {};
  return (
    <PageRenderer
      {...shared}
      {...sheet}
      document={region.document}
      {...(region.definitions === undefined || region.definitions.size === 0
        ? {}
        : { definitions: region.definitions })}
    />
  );
}

/** The open tag: where the region comes from, and the way to edit it. */
function RegionTag({
  region,
  id,
}: {
  region: CanvasRegion;
  id: string;
}): JSX.Element {
  return (
    <div className="nx-canvas-region__tag" id={id} role="status">
      <span>{region.label}</span>
      {region.note === undefined ? null : (
        <span className="nx-canvas-region__note">{region.note}</span>
      )}
      {region.edit === undefined ? null : (
        <a
          className="nx-canvas-region__edit"
          href={region.edit.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={region.edit.name}
        >
          {region.edit.text}
        </a>
      )}
    </div>
  );
}

/**
 * The region's and its lock's handlers: hover and focus widen the lock into
 * its badge, a click on the region opens the tag and one on the lock toggles
 * it, Escape closes it back onto the lock, and focus leaving closes it.
 */
function useRegionHandlers(
  setState: (next: MarkState | ((now: MarkState) => MarkState)) => void,
  frame: RefObject<HTMLDivElement | null>,
  lock: RefObject<HTMLButtonElement | null>,
  open: boolean
) {
  const rest = (): void => setState("rest");
  const widen = (): void => setState(now => (now === "rest" ? "hover" : now));
  return {
    rest,
    frame: {
      onFocus: (event: FocusEvent<HTMLDivElement>) => {
        if (event.target === frame.current) lock.current?.focus();
      },
      onClick: () => setState("open"),
      onMouseEnter: widen,
      onMouseLeave: () =>
        setState(now =>
          now === "hover" && !hasFocusIn(frame.current) ? "rest" : now
        ),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || !open) return;
        setState("hover");
        lock.current?.focus();
      },
      onBlur: (event: FocusEvent<HTMLDivElement>) => {
        // Closed once focus leaves the region and its tag together, so
        // moving from the lock to the Edit link keeps the tag open.
        if (!frame.current?.contains(event.relatedTarget)) rest();
      },
    },
    lock: {
      onFocus: widen,
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        // The lock toggles; the region's own click only opens.
        event.stopPropagation();
        setState(now => (now === "open" ? "hover" : "open"));
      },
    },
  };
}

/** Whether focus is on an element inside `root`. */
function hasFocusIn(root: HTMLElement | null): boolean {
  const focused = root?.ownerDocument.activeElement ?? null;
  return root !== null && focused !== null && root.contains(focused);
}

/** Where the mark sits: which side of the page edge, and how far in. */
interface MarkPlace {
  readonly placement: RegionMarkPlacement;
  readonly left: number;
}

/**
 * The mark's place, measured whenever it changes size (a state change) and
 * whenever the page or the canvas around the frame scrolls or resizes, so a
 * mark that would leave the screen is brought back onto it.
 */
function useMarkPlace(
  frame: RefObject<HTMLDivElement | null>,
  mark: RefObject<HTMLDivElement | null>,
  area: RegionArea,
  canvas: CanvasFrame,
  state: MarkState
): MarkPlace {
  const [place, setPlace] = useState<MarkPlace>(AT_REST);
  useIsomorphicLayoutEffect(() => {
    const measure = (): void => {
      const next = markPlaceOf(frame.current, mark.current, area, canvas);
      if (next === undefined) return;
      setPlace(now =>
        now.placement === next.placement && now.left === next.left ? now : next
      );
    };
    measure();
    let pending = 0;
    const later = (): void => {
      const view = frame.current?.ownerDocument.defaultView;
      if (view === null || view === undefined || pending !== 0) return;
      pending = view.requestAnimationFrame(() => {
        pending = 0;
        measure();
      });
    };
    // What moves the part on screen: the canvas's scroller and, around a
    // frame, the editor's (`screenScrollers`), and either window's size.
    const root = rootOf(frame.current);
    const scrollers = root === null ? [] : screenScrollers(root, canvas.frame);
    for (const scroller of scrollers) {
      scrollEventTarget(scroller).addEventListener("scroll", later, {
        passive: true,
      });
    }
    const documents = inputDocuments(canvas);
    for (const doc of documents) {
      doc.defaultView?.addEventListener("resize", later);
    }
    return () => {
      for (const scroller of scrollers) {
        scrollEventTarget(scroller).removeEventListener("scroll", later);
      }
      for (const doc of documents) {
        doc.defaultView?.removeEventListener("resize", later);
      }
      if (pending !== 0) {
        frame.current?.ownerDocument.defaultView?.cancelAnimationFrame(pending);
      }
    };
  }, [frame, mark, area, canvas, state]);
  return place;
}

/** Outside, at the inset: where a mark sits before anything is measured. */
const AT_REST: MarkPlace = { placement: "outside", left: REGION_MARK_INSET };

/** The canvas root a region is drawn in, or `null` before it is. */
function rootOf(region: HTMLElement | null): HTMLElement | null {
  return region === null ? null : canvasRootFrom(region, CANVAS_ROOT_CLASS);
}

/**
 * The mark's place from the boxes as drawn, or nothing before they are: the
 * region's and the mark's boxes and the part of the canvas on screen, all in
 * the canvas's content coordinates, read through the one geometry module.
 */
function markPlaceOf(
  region: HTMLElement | null,
  mark: HTMLElement | null,
  area: RegionArea,
  canvas: CanvasFrame
): MarkPlace | undefined {
  const root = rootOf(region);
  if (region === null || mark === null || root === null) return undefined;
  const box = canvasContentRect(region, root);
  const size = canvasContentRect(mark, root);
  const band = onScreenBandOf(root, canvas.frame);
  return {
    placement: regionMarkPlacement({
      area: area === "footer" ? "footer" : "header",
      edge: { top: box.y - band.y, bottom: box.y + box.height - band.y },
      height: size.height,
      viewport: band.height,
    }),
    left: regionMarkLeft({
      region: { left: box.x, right: box.x + box.width },
      visible: { left: band.x, right: band.x + band.width },
      width: size.width,
    }),
  };
}

/**
 * Close the open tag on a press anywhere outside the region: on the page, in
 * the editor's panels, wherever the canvas's documents are.
 */
function useClosedOnOutsidePress(
  open: boolean,
  frame: RefObject<HTMLDivElement | null>,
  canvas: CanvasFrame,
  close: () => void
): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    const onPress = (event: Event): void => {
      const target = event.target;
      // Read by shape, not `instanceof`: a press in the frame comes from
      // another window, whose nodes are not this window's `Node`s.
      const inside =
        typeof target === "object" &&
        target !== null &&
        "nodeType" in target &&
        frame.current?.contains(target as Node) === true;
      if (!inside) latest.current();
    };
    const documents = inputDocuments(canvas);
    for (const doc of documents) {
      doc.addEventListener("pointerdown", onPress, true);
    }
    return () => {
      for (const doc of documents) {
        doc.removeEventListener("pointerdown", onPress, true);
      }
    };
  }, [open, frame, canvas]);
}

/** Close the open tag when the canvas selects something else. */
function useClosedOnSelection(
  selection: readonly string[] | undefined,
  close: () => void
): void {
  const key = selection === undefined ? "" : selection.join("\u0000");
  const seen = useRef(key);
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (seen.current === key) return;
    seen.current = key;
    latest.current();
  }, [key]);
}
