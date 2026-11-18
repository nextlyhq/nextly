/**
 * The regions of a page's layout, its header and footer, drawn on the canvas
 * around the page.
 *
 * A layout's header and footer are what a visitor sees around the page, so the
 * canvas draws them, from the PUBLISHED documents the host hands over. They
 * are not the page's to edit: nothing in them can be dragged onto or typed
 * into, and their links and forms are inert. Each is selected as a whole, by
 * a click or by Enter or Space on its one Tab stop, and the host's sidebar
 * then says where it comes from (`region-selection` holds which one).
 *
 * Drawn as part of the canvas's rendered subtree, inside the canvas root, so
 * whatever surface the canvas lives on (today the admin page, later the
 * editor's own frame) carries them with the page.
 *
 * What marks a region is drawn inside it, never over the page: the outline on
 * the region's own edge, and a small tag at its top left (its bottom left
 * where the top is scrolled away; `canvas-region-placement` has where). A
 * mark hanging past the region covered the page's first or last block, and
 * hover flickered along the strip it covered.
 *
 * A region is drawn again only when what it is drawn from changes: its
 * document, its definitions, its sheet and the canvas's shared inputs. The
 * hover cue is the stylesheet's (`:hover`, `:focus-visible`), not React state,
 * and what its async blocks drew (a logo, a button) is kept between draws, so
 * an insert on the page or the pointer resting on the footer never blinks it.
 *
 * @module canvas-regions
 */
import type {
  BlockDocument,
  DefinitionsById,
  RegionArea,
} from "@nextlyhq/blocks-engine";
import {
  createStandaloneContext,
  PageRenderer,
  type PageRendererProps,
  type PartSheet,
} from "@nextlyhq/blocks-react";
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import {
  memo,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";

import { CANVAS_ROOT_CLASS } from "../shell-state";

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
import { pageSchemeOf } from "./site-ground";

/**
 * The class on a Layout region's frame. Its blocks are a document of their
 * own, drawn inside the canvas around the page's, so a mark that belongs to
 * the page's blocks is kept off anything inside it.
 */
export const CANVAS_REGION_CLASS = "nx-canvas-region";

/** One region of the page's layout, as the host hands it to the canvas. */
export interface CanvasRegion {
  /** Which area: drawn before the page for a header, after it for a footer. */
  readonly area: RegionArea;
  /** The region's document: one instance of the component filling the area. */
  readonly document: BlockDocument;
  /** The PUBLISHED definitions that document reaches, nested ones included. */
  readonly definitions?: DefinitionsById;
  /**
   * What the region is and where it comes from, as it is announced: "Site
   * header, from the Main header & footer".
   */
  readonly label: string;
  /** Its tag while the pointer or focus is on it: "Site header · Main". */
  readonly badge: string;
  /** Its tag while it is selected: "Site header". */
  readonly name: string;
  /**
   * The way to edit what it comes from, for someone who may: a link that
   * opens in a new tab, offered where a block of it is named off the canvas
   * (the page data panel). Absent for anyone else.
   */
  readonly edit?: {
    readonly href: string;
    /** The visible text. */
    readonly text: string;
    /** The accessible name, which says it opens in a new tab. */
    readonly name: string;
  };
}

/** The attribute naming a drawn region's area, for a host scrolling to it. */
export const REGION_ATTRIBUTE = "data-nx-region";

/** The attribute a drawn region carries while it is selected. */
const REGION_SELECTED_ATTRIBUTE = "data-selected";

/**
 * One region on the canvas, selected as a whole.
 *
 * Its content is `inert`: the region's links and forms cannot be followed or
 * focused, and the pointer falls through to the region itself, which answers
 * a click by asking to be selected. The region is its own one Tab stop, named
 * for what it is and where it comes from; Enter or Space selects it.
 *
 * Marked as chrome, so the canvas's block selection, hit-testing and link
 * guard all leave it alone: it is not part of the document being edited.
 */
export function CanvasRegionFrame({
  region,
  rendered,
  sheet,
  selected,
  onSelect,
  onEdit,
  dimmed,
}: {
  region: CanvasRegion;
  /** The canvas's own renderer inputs, less what belongs to the page alone. */
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  /** How this part treats the site sheet, and the scope it compiles under. */
  sheet: PartSheet;
  /** Whether this region is the canvas's selection. */
  selected: boolean;
  /** Ask for this region to be selected; absent, the region selects nothing. */
  onSelect: ((area: RegionArea) => void) | undefined;
  /**
   * Ask to edit this region in place: a double-click, or Enter while it is
   * selected. Absent, the region is only ever selected.
   */
  onEdit: ((area: RegionArea) => void) | undefined;
  /**
   * Whether another region is edited in place: then this one is out of
   * reach, as the page is, and hidden from assistive technology.
   */
  dimmed: boolean;
}): JSX.Element {
  const frame = useRef<HTMLDivElement | null>(null);
  const tag = useRef<HTMLSpanElement | null>(null);
  const canvas = useCanvasFrame();
  const place = useMarkPlace(frame, tag, canvas, selected);
  const choose = (): void => {
    if (!selected) onSelect?.(region.area);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    // Space would scroll the canvas; Enter is the region's own here.
    event.preventDefault();
    // Enter selects the region, and Enter again edits it.
    if (event.key === "Enter" && selected && onEdit !== undefined) {
      onEdit(region.area);
      return;
    }
    choose();
  };
  // A double-click goes straight in: selected on its first click, edited on
  // the second. Kept from the canvas's own double-click, which opens a
  // block's text and has no block here.
  const edit = (event: MouseEvent<HTMLDivElement>): void => {
    if (onEdit === undefined) return;
    event.stopPropagation();
    onEdit(region.area);
  };

  return (
    <div
      ref={frame}
      className={CANVAS_REGION_CLASS}
      {...{ [CHROME_ATTRIBUTE]: "", [REGION_ATTRIBUTE]: region.area }}
      {...(selected ? { [REGION_SELECTED_ATTRIBUTE]: "" } : {})}
      role="button"
      aria-label={region.label}
      aria-pressed={selected}
      tabIndex={0}
      onClick={choose}
      onDoubleClick={edit}
      onKeyDown={onKeyDown}
      // Out of reach and unheard while another region is edited in place.
      inert={dimmed}
      aria-hidden={dimmed ? "true" : undefined}
      // The ground under the marks, judged as the pointer arrives, since a
      // hover cue changes no state and so runs no effect.
      onPointerEnter={() => markScheme(frame.current)}
    >
      <div className="nx-canvas-region__content" inert>
        <RegionContent
          document={region.document}
          definitions={region.definitions}
          rendered={rendered}
          sheet={sheet}
        />
      </div>
      <span
        ref={tag}
        className="nx-canvas-region__tag"
        data-placement={place.placement}
        style={{ left: place.left }}
        // The region's own name says what the tag does.
        aria-hidden="true"
      >
        {selected ? region.name : region.badge}
      </span>
    </div>
  );
}

/**
 * The region being edited in place: drawn from the live document being
 * edited, its blocks addressed and within reach, so it is edited as a page
 * is. No longer chrome and no longer a button: a click lands on its blocks.
 * It keeps its area's attribute, so the dim over the rest of the canvas is
 * measured around it, and its edge where it meets the page.
 */
export function EditedRegionFrame({
  area,
  document,
  definitions,
  rendered,
  sheet,
}: {
  area: RegionArea;
  /** Its document as it stands, edit by edit. */
  document: BlockDocument;
  definitions: DefinitionsById | undefined;
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  sheet: PartSheet;
}): JSX.Element {
  return (
    <div
      className={CANVAS_REGION_CLASS}
      {...{ [REGION_ATTRIBUTE]: area, [REGION_EDITED_ATTRIBUTE]: "" }}
    >
      <RegionContent
        document={document}
        definitions={definitions}
        rendered={rendered}
        sheet={sheet}
        addressed
      />
    </div>
  );
}

/** The attribute a region carries while it is edited in place. */
export const REGION_EDITED_ATTRIBUTE = "data-nx-region-edited";

/**
 * State on the region the page's ground it is drawn over, so its marks take
 * the hue for that ground, as the block marks over the page do.
 */
function markScheme(region: HTMLElement | null): void {
  const root = rootOf(region);
  if (region === null || root === null) return;
  region.setAttribute(PAGE_SCHEME_ATTRIBUTE, pageSchemeOf(root));
}

/** The attribute stating the page's ground under a region's marks. */
const PAGE_SCHEME_ATTRIBUTE = "data-nx-page-scheme";

/** What a region's content is drawn from. */
interface RegionContentProps {
  document: BlockDocument;
  definitions: DefinitionsById | undefined;
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  sheet: PartSheet;
  /** Whether its blocks carry their addresses: only while it is edited. */
  addressed?: boolean;
}

/**
 * The region's own document, drawn with the canvas's inputs, and drawn again
 * only when one of them changes (`sameRegionDraw`).
 */
const RegionContent = memo(function RegionContent({
  document,
  definitions,
  rendered,
  sheet,
  addressed = false,
}: RegionContentProps): JSX.Element {
  const {
    styles: _pageStyles,
    definitions: _pageDefinitions,
    ...shared
  } = rendered ?? {};
  // One context for as long as the region is drawn, where the canvas hands
  // none: what its async blocks drew is kept per context.
  const ownContext = useMemo(() => createStandaloneContext(), []);
  return (
    <PageRenderer
      {...shared}
      context={shared.context ?? ownContext}
      {...sheet}
      document={document}
      {...(definitions === undefined || definitions.size === 0
        ? {}
        : { definitions })}
      // An image or a button already drawn stays drawn when the region is
      // drawn again, rather than blinking out while it runs again. Never on
      // a published page, which this is not.
      keepAsyncOutputs
      // Addressed while it is edited in place, so the canvas's hover,
      // selection, inline editing and drag find its blocks as a page's.
      nodeAttribute={addressed}
    />
  );
}, sameRegionDraw);

/**
 * Whether two draws of a region's content would draw the same: the same
 * document and definitions, and the canvas's inputs and the part's sheet
 * equal field by field. The canvas hands a new object for each after an edit
 * on the page (an insert, a style), with the same values in it; the page's
 * own styles and definitions are not the region's and are never read.
 */
function sameRegionDraw(
  before: RegionContentProps,
  after: RegionContentProps
): boolean {
  return (
    before.document === after.document &&
    before.definitions === after.definitions &&
    before.addressed === after.addressed &&
    sameFields(regionInputs(before.rendered), regionInputs(after.rendered)) &&
    before.sheet.siteStyles === after.sheet.siteStyles &&
    sameFields(before.sheet.styleContext, after.sheet.styleContext)
  );
}

/** The canvas's inputs a region reads: all but the page's own. */
function regionInputs(
  rendered: RegionContentProps["rendered"]
): object | undefined {
  if (rendered === undefined) return undefined;
  const { styles: _styles, definitions: _definitions, ...shared } = rendered;
  return shared;
}

/** Whether two objects hold the same values under the same keys. */
function sameFields(
  before: object | undefined,
  after: object | undefined
): boolean {
  if (before === after) return true;
  if (before === undefined || after === undefined) return false;
  const keys = Object.keys(before);
  if (keys.length !== Object.keys(after).length) return false;
  return keys.every(
    key =>
      Object.hasOwn(after, key) &&
      Object.is(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key]
      )
  );
}

/** Where the tag sits: which corner inside the region, and how far in. */
interface MarkPlace {
  readonly placement: RegionMarkPlacement;
  readonly left: number;
}

/**
 * The tag's place, measured whenever it changes size (its words changing on
 * selection, at once; on hover, a frame later) and whenever the page or the
 * canvas around the frame scrolls or resizes, so a tag that would leave the
 * screen is brought back onto it. The ground under the marks is judged with
 * it.
 */
function useMarkPlace(
  frame: RefObject<HTMLDivElement | null>,
  mark: RefObject<HTMLSpanElement | null>,
  canvas: CanvasFrame,
  selected: boolean
): MarkPlace {
  const [place, setPlace] = useState<MarkPlace>(AT_REST);
  useIsomorphicLayoutEffect(() => {
    const measure = (): void => {
      markScheme(frame.current);
      const next = markPlaceOf(frame.current, mark.current, canvas);
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
    // The mark's own size, which the stylesheet changes on hover and focus
    // without a render. Read from the mark's window, which in a frame is not
    // this one's.
    const Observer = mark.current?.ownerDocument.defaultView?.ResizeObserver;
    const sized = Observer === undefined ? undefined : new Observer(later);
    if (mark.current !== null) sized?.observe(mark.current);
    return () => {
      sized?.disconnect();
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
  }, [frame, mark, canvas, selected]);
  return place;
}

/** At the top, at the inset: where a tag sits before anything is measured. */
const AT_REST: MarkPlace = { placement: "top", left: REGION_MARK_INSET };

/** The canvas root a region is drawn in, or `null` before it is. */
function rootOf(region: HTMLElement | null): HTMLElement | null {
  return region === null ? null : canvasRootFrom(region, CANVAS_ROOT_CLASS);
}

/**
 * The tag's place from the boxes as drawn, or nothing before they are: the
 * region's and the tag's boxes and the part of the canvas on screen, all in
 * the canvas's content coordinates, read through the one geometry module.
 */
function markPlaceOf(
  region: HTMLElement | null,
  mark: HTMLElement | null,
  canvas: CanvasFrame
): MarkPlace | undefined {
  const root = rootOf(region);
  if (region === null || mark === null || root === null) return undefined;
  const box = canvasContentRect(region, root);
  const size = canvasContentRect(mark, root);
  const band = onScreenBandOf(root, canvas.frame);
  // The tag's inset from the edge it sits against, as drawn: it needs that
  // room as well as its own height, or it reaches past the region's other
  // edge over the page.
  const inset =
    mark.getAttribute("data-placement") === "bottom"
      ? box.y + box.height - (size.y + size.height)
      : size.y - box.y;
  return {
    placement: regionMarkPlacement({
      edge: { top: box.y - band.y, bottom: box.y + box.height - band.y },
      height: size.height + Math.max(inset, 0),
      viewport: band.height,
    }),
    left: regionMarkLeft({
      region: { left: box.x, right: box.x + box.width },
      visible: { left: band.x, right: band.x + band.width },
      width: size.width,
    }),
  };
}

/** The attribute on a band drawn where an area has no region, naming the area. */
export const EMPTY_REGION_ATTRIBUTE = "data-nx-region-empty";

/** A rectangle in the editor's own coordinates, where a menu opens from. */
export interface EmptyRegionAnchor {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * What the host has the band say and offer where an area has no region: why
 * the area is empty, and either the two ways to fill it or who to ask.
 * @experimental Settles with the site's empty header and footer.
 */
export interface EmptyRegionBandProps {
  /** The area has nothing yet, and what that means for the site's pages. */
  readonly sentence: string;
  readonly actions:
    | {
        /** Fill it with a new one, as "Create a header" says. */
        readonly create: string;
        readonly onCreate: () => void;
        /** Choose one already made, as "Use a component" says. */
        readonly use: string;
        /**
         * Open the choice, from the button's place in the editor's own
         * coordinates: the menu is drawn there, over the canvas.
         */
        readonly onUse: (anchor: EmptyRegionAnchor) => void;
        /** While a choice is being written: both wait. */
        readonly busy?: boolean;
      }
    | {
        /** For someone who may not fill it: who can. */
        readonly ask: string;
      };
}

/**
 * The band drawn in an area's place on the canvas while the page's header &
 * footer set has nothing there: a dashed box saying so, with the host's ways
 * to fill it. Drawn in the editor's canvas alone, in the region's place and
 * never in the page: a visitor's page draws nothing there.
 *
 * Its buttons are the frame's own, styled by the frame's sheet with the
 * values the editor hands it, since the editor's stylesheet does not reach
 * into the frame. The choice it opens is the host's, drawn over the canvas
 * in the editor's document, from the button's place mapped there.
 */
export function EmptyRegionBand({
  area,
  band,
}: {
  readonly area: RegionArea;
  readonly band: EmptyRegionBandProps;
}): JSX.Element {
  const canvas = useCanvasFrame();
  const { actions } = band;
  // The button's box in the frame, mapped corner by corner to the editor's
  // coordinates, as a context menu opened in the frame is.
  const anchorOf = (element: HTMLElement): EmptyRegionAnchor => {
    const box = element.getBoundingClientRect();
    const start = canvas.toHost({ x: box.left, y: box.top });
    const end = canvas.toHost({ x: box.right, y: box.bottom });
    return {
      x: start.x,
      y: start.y,
      width: end.x - start.x,
      height: end.y - start.y,
    };
  };
  return (
    <div
      className="nx-canvas-region-empty"
      {...{ [CHROME_ATTRIBUTE]: "", [EMPTY_REGION_ATTRIBUTE]: area }}
      role="group"
      aria-label={area === "header" ? "Site header" : "Site footer"}
      // A press here is the band's, never a selection on the canvas.
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
    >
      <p className="nx-canvas-region-empty__sentence">{band.sentence}</p>
      {"ask" in actions ? (
        <p className="nx-canvas-region-empty__ask">{actions.ask}</p>
      ) : (
        <div className="nx-canvas-region-empty__actions">
          <button
            type="button"
            data-nx-region-empty-action="create"
            disabled={actions.busy === true}
            onClick={() => actions.onCreate()}
          >
            {actions.create}
          </button>
          <button
            type="button"
            data-nx-region-empty-action="use"
            aria-haspopup="listbox"
            disabled={actions.busy === true}
            onClick={event => actions.onUse(anchorOf(event.currentTarget))}
          >
            {actions.use}
            <span aria-hidden="true"> ▾</span>
          </button>
        </div>
      )}
    </div>
  );
}
