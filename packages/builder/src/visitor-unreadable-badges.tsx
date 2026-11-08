"use client";

/**
 * The badge on a block whose bound value a visitor will not see.
 *
 * The canvas draws a page's bound props from sources read as the person
 * editing, who may read fields a visitor may not. A binding to such a field
 * falls back on the published page, so the author is told on the block itself:
 * the block is outlined in a faint amber dash, and a small "Visitors won't see
 * this" badge sits on that outline's top-right edge, a tab of it, with the
 * field and what a visitor sees instead in a tooltip: a fallback chosen from
 * the media library named by its file, with a small picture of it, as the
 * host's `readMedia` reads it, never by its raw id. The outline is what makes
 * the badge plainly this block's: on blocks stacked tight, a badge alone above
 * a block reads as the mark of the one above it.
 *
 * Which bindings those are is the host's question, answered by the engine's
 * `visitorUnreadableBindings` (the published page's own binding check, with the
 * field shapes a visitor may read); this only draws the answer.
 *
 * A layer of its own rather than a mark in `canvas-marks.tsx`: the marks are
 * boxes hidden from assistive technology, and this badge is a control a
 * keyboard reaches. Its tooltip shows on focus as well as on hover, and Escape
 * hides it without moving either.
 *
 * Placed as `empty-container-appender.tsx` places its controls: the block's
 * element found by its id, measured through `canvasContentRect` and placed in
 * the chrome's coordinates, so it lands right at any zoom. The outline runs
 * just outside the block's box, as the selection ring does, and the badge
 * above it, so neither covers the block's own content; the badge goes inside
 * the outline's top corner only when the block starts at the top of what is
 * on screen, where nothing above it is drawn, as the canvas's other tags do.
 *
 * Where another tab is in the way, the badge takes the next place it may use:
 * another block's badge or at-rest tab ("Conditional"), this block's own
 * at-rest tab, or the block toolbar over a selected block. Every layer drawing
 * tabs over the canvas posts them to one board and places them by one pass
 * (`canvas-tab-places.ts`), so the badge then sits on its outline's bottom
 * edge, or inside its top corner, or steps left along the edge, as the
 * at-rest tabs do.
 *
 * @module visitor-unreadable-badges
 */

import {
  imageValueOf,
  type VisitorUnreadableBinding,
} from "@nextlyhq/blocks-engine";
import { EyeOff } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { CANVAS_ROOT_CLASS, CHROME_ATTRIBUTE, nodeElement } from "./canvas";
import { useCanvasFrame } from "./canvas-frame-context";
import { watchCanvasFor, watchScreenBand } from "./canvas-geometry-watch";
import {
  overlaps,
  tabBoardOf,
  useTabPost,
  type TabAt,
  type TabDraft,
} from "./canvas-tab-places";
import { useMediaSummary, type MediaSummary } from "./content-controls";
import type { Rect } from "./geometry";
import {
  canvasContentRect,
  clippedByAncestorRect,
  onScreenOf,
  overlaySpaceOf,
  type OverlaySpace,
} from "./geometry-dom";

/** The badge's words: what the author needs to know, at a glance. */
const VISITOR_UNREADABLE_WORDS = "Visitors won't see this";

/**
 * How far outside the block's box its dashed outline runs: as far as the
 * selection ring, so the outline never covers the block's own content.
 */
const OUTLINE_OUTSET_PX = 2;
/** The badge's height, as the stylesheet draws it. */
const BADGE_HEIGHT_PX = 22;
/**
 * About how wide the badge is drawn, for its first placement: its 11px words,
 * icon and padding, erring wide. Once drawn, its own width is used.
 */
const BADGE_WIDTH_ESTIMATE_PX = 170;
/**
 * The tooltip's widest, as the stylesheet caps it (18rem). Right-aligned with
 * the badge it runs this far left at most; a badge nearer the screen's left
 * edge than this has its tooltip start at its own left edge instead, so the
 * tooltip is never cut by the canvas's edge.
 */
const TIP_MAX_WIDTH_PX = 288;

/**
 * Whether a badge whose right edge is at `right` has its tooltip run right
 * from its left edge: the screen, starting at `screenLeft`, has too little
 * room left of `right` for the widest tooltip to run left from there.
 */
export function tipRunsFromStart(right: number, screenLeft: number): boolean {
  return right - screenLeft < TIP_MAX_WIDTH_PX;
}

/** The badge's drawn width for `id`, or the estimate before it is drawn. */
function badgeWidthOf(
  layer: HTMLElement | null,
  space: OverlaySpace,
  id: string
): number {
  const drawn = layer?.querySelector(`[data-badge-node="${CSS.escape(id)}"]`);
  // In the chrome's coordinates, as the outline and the band are: measured
  // through the overlay's own normalization, which a scaled canvas needs.
  const width = drawn instanceof HTMLElement ? space.sizeOf(drawn).width : 0;
  return width > 0 ? width : BADGE_WIDTH_ESTIMATE_PX;
}

/** Where one block's mark is drawn, in the chrome's coordinates. */
interface BadgePlace {
  /** The dashed outline around the block, just outside its box. */
  readonly outline: Rect;
  /** The badge's right edge: the outline's, or the screen's when nearer. */
  readonly right: number;
  /** The badge's top; its right edge is the outline's right edge. */
  readonly top: number;
  /**
   * Where the badge sits: on the outline's top edge, a tab of it; on its
   * bottom edge where something else takes the top; or inside its top corner
   * where there is no room above it on screen.
   */
  readonly at: TabAt;
  /**
   * The tooltip runs right from the badge's left edge: too little room on
   * screen to the badge's left for it to run left from the badge's right.
   */
  readonly tipFromStart: boolean;
}

/** One marked block as measured: its outline, and its badge to place. */
interface MeasuredBadge {
  readonly id: string;
  readonly outline: Rect;
  readonly tab: TabDraft;
}

/** The badge's top for a place on `outline`, its border shared with the dash. */
function badgeTopOf(outline: Rect, at: TabAt): number {
  if (at === "inside") return outline.y;
  return at === "below"
    ? outline.y + outline.height - 1
    : outline.y - BADGE_HEIGHT_PX + 1;
}

/** Where a badge may go on `outline`, in order of preference. */
function badgePlacesOf(outline: Rect, onScreen: Rect): TabAt[] {
  // On the outline's top edge where there is room above it on screen, else
  // inside its top corner, as alone; on its bottom edge, where there is room
  // below, when another tab takes the first.
  const above = outline.y - onScreen.y >= BADGE_HEIGHT_PX;
  const below =
    outline.y + outline.height + BADGE_HEIGHT_PX <=
    onScreen.y + onScreen.height;
  const bottom = below ? (["below"] as const) : [];
  return above ? ["above", ...bottom, "inside"] : ["inside", ...bottom];
}

/**
 * The block `id`'s outline and badge to place, measured in the chrome's
 * coordinates, or nothing where there is no block on screen to point at.
 */
function measuredBadgeOf(
  layer: HTMLElement | null,
  space: OverlaySpace,
  onScreen: Rect,
  id: string
): MeasuredBadge | undefined {
  const target = nodeElement(space.root, id);
  // A block the page draws nothing for, or one an ancestor clips, has no
  // place on screen a badge could point at.
  if (target === null || clippedByAncestorRect(target, space.root)) {
    return undefined;
  }
  const box = space.place(canvasContentRect(target, space.root));
  if (box.width === 0 && box.height === 0) return undefined;
  // A block wholly off screen gets no badge: one the layer clips away would
  // still be a stop for the keyboard, with nothing to see.
  if (!overlaps(box, onScreen)) return undefined;
  const outline: Rect = {
    x: box.x - OUTLINE_OUTSET_PX,
    y: box.y - OUTLINE_OUTSET_PX,
    width: box.width + OUTLINE_OUTSET_PX * 2,
    height: box.height + OUTLINE_OUTSET_PX * 2,
  };
  const width = badgeWidthOf(layer, space, id);
  // In from the screen's right edge as far as the block runs past it, and
  // never so far left that the badge, drawn leftwards from here, runs past
  // the screen's left edge: a block scrolled partly off either side keeps
  // its whole badge in view.
  const right = Math.max(
    Math.min(outline.x + outline.width, onScreen.x + onScreen.width),
    onScreen.x + width
  );
  return {
    id,
    outline,
    tab: {
      block: box,
      edge: outline,
      places: badgePlacesOf(outline, onScreen),
      side: outline.x + outline.width - right,
      width,
      height: BADGE_HEIGHT_PX,
      // Sitting on the outline's edge, its border shared with the outline's,
      // so the two read as one mark of this block.
      foot: 1,
    },
  };
}

export interface VisitorUnreadableBadgesProps {
  /** The bindings a visitor will not see filled, by the id of the node holding them. */
  readonly marked: ReadonlyMap<string, readonly VisitorUnreadableBinding[]>;
  /** Pressed: the host selects the block, whose inspector says it in full. */
  readonly onSelect?: (nodeId: string) => void;
  /** Hidden while the canvas is mid-drag, as the other controls over it are. */
  readonly hidden?: boolean;
  /**
   * A media item by its id, as the inspector reads one, so a fallback chosen
   * from the library is named by its file. Absent, such a fallback is said
   * to be a library image, without its name.
   */
  readonly readMedia?: (mediaId: string) => Promise<MediaSummary | null>;
}

/**
 * The media id an image binding's fallback names, when it is a file from the
 * library rather than an address. Asked only of an image prop, by the
 * engine's reading of an image value: the same text on a heading is text.
 */
function fallbackMediaId(
  binding: VisitorUnreadableBinding
): string | undefined {
  if (binding.kind !== "image" || binding.fallback === undefined) {
    return undefined;
  }
  const read = imageValueOf(binding.fallback.value);
  return read?.holds === "media" ? read.value : undefined;
}

/**
 * A fallback as a reader sees it: text quoted, a library file named by its
 * file name (`fileName`, once read), anything else named.
 */
function fallbackWords(
  binding: VisitorUnreadableBinding,
  fileName: string | undefined
): string {
  if (binding.fallback === undefined) {
    return "They see the block's own value instead.";
  }
  // A media id is no word a reader knows: the file it names, or that it is
  // a file, while that is read or where it can't be.
  if (fallbackMediaId(binding) !== undefined) {
    return fileName === undefined
      ? "They see a fallback image from the library."
      : `They see the fallback image “${fileName}”.`;
  }
  const value = binding.fallback.value;
  return typeof value === "string" && value.trim() !== ""
    ? `They see the fallback: “${value}”.`
    : "They see the fallback instead.";
}

/**
 * One sentence per binding: the field, and what a visitor sees instead.
 * Synchronous, so a library file's name is handed in once read
 * (`fileName`); without it the file is said to be a library image.
 */
export function visitorUnreadableSentence(
  binding: VisitorUnreadableBinding,
  fileName?: string
): string {
  return `Visitors can't read “${binding.path}”. ${fallbackWords(binding, fileName)}`;
}

/**
 * One binding's sentence, its library fallback read by its id through
 * `readMedia` and named by its file; with `pictured`, a small picture of
 * that file before it, where the badge's tooltip has room for one.
 */
export function VisitorUnreadableLine({
  binding,
  readMedia,
  pictured = false,
}: {
  readonly binding: VisitorUnreadableBinding;
  readonly readMedia:
    | ((mediaId: string) => Promise<MediaSummary | null>)
    | undefined;
  readonly pictured?: boolean;
}): ReactElement {
  const summary = useMediaSummary(readMedia, fallbackMediaId(binding) ?? null);
  const sentence = visitorUnreadableSentence(binding, summary?.name);
  const thumbnail = pictured ? summary?.thumbnail : undefined;
  if (thumbnail === undefined) return <>{sentence}</>;
  return (
    <span className="nx-visitor-unreadable__pictured">
      {/* Decorative: the sentence names the file. */}
      <img
        className="nx-visitor-unreadable__thumb"
        src={thumbnail}
        alt=""
        decoding="async"
      />
      <span>{sentence}</span>
    </span>
  );
}

/**
 * The badges over the canvas's blocks whose bound values a visitor will not
 * see.
 *
 * @experimental
 */
export function VisitorUnreadableBadges({
  marked,
  onSelect,
  hidden = false,
  readMedia,
}: VisitorUnreadableBadgesProps): ReactElement | null {
  const layer = useRef<HTMLDivElement | null>(null);
  const [places, setPlaces] = useState<ReadonlyMap<string, BadgePlace>>(
    () => new Map()
  );
  // The badge whose tooltip Escape put away, until it is left.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const idPrefix = useId();
  const canvasFrame = useCanvasFrame();

  // The last measure, which placing the badges again reads: another layer's
  // post moves where the badges go, not which blocks have one.
  const measured = useRef<{
    readonly root: HTMLElement | null;
    readonly badges: readonly MeasuredBadge[];
    /** The left edge of what of the canvas is on screen, as last measured. */
    readonly screenLeft: number;
  }>({ root: null, badges: [], screenLeft: 0 });

  // The badges as last measured, placed where the board puts them now, with
  // the canvas's other tabs and the block toolbar.
  const placeBadges = useCallback(() => {
    const { root, badges, screenLeft } = measured.current;
    const placements =
      root === null ? [] : tabBoardOf(root).placesOf("visitor");
    const next = new Map<string, BadgePlace>();
    badges.forEach(({ id, outline, tab }, index) => {
      const { at, side } = placements[index] ?? {
        at: tab.places[0] ?? "inside",
        side: tab.side,
      };
      const right = outline.x + outline.width - side;
      next.set(id, {
        outline,
        right,
        top: badgeTopOf(outline, at),
        at,
        // Read from where the badge is placed, which a step left to keep
        // clear of another tab moves, so its tooltip still fits on screen.
        tipFromStart: tipRunsFromStart(right, screenLeft),
      });
    });
    setPlaces(next);
  }, []);
  const postTabs = useTabPost("visitor", placeBadges);

  const measure = useCallback(() => {
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) {
      measured.current = { root: null, badges: [], screenLeft: 0 };
      postTabs(null);
      setPlaces(current => (current.size === 0 ? current : new Map()));
      return;
    }
    const onScreen = onScreenOf(space);
    const badges = [...marked.keys()].flatMap(id => {
      const badge = measuredBadgeOf(element, space, onScreen, id);
      return badge === undefined ? [] : [badge];
    });
    measured.current = { root: space.root, badges, screenLeft: onScreen.x };
    postTabs(space.root, { tabs: badges.map(({ tab }) => tab), taken: [] });
    placeBadges();
  }, [marked, postTabs, placeBadges]);

  useLayoutEffect(() => {
    // Hidden, the layer draws no badge, so no other tab keeps clear of one.
    if (hidden) {
      postTabs(null);
      return;
    }
    measure();
  }, [measure, hidden, canvasFrame, postTabs]);

  useEffect(() => {
    if (hidden || marked.size === 0) return;
    return watchCanvasFor(() => layer.current, measure);
  }, [measure, hidden, marked, canvasFrame]);

  // The scrolls that move what of the canvas is on screen, which decide
  // whether a badge has room above its block.
  useEffect(() => {
    if (hidden || marked.size === 0) return;
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) return;
    return watchScreenBand(space.root, space.frame, measure);
  }, [measure, hidden, marked, canvasFrame]);

  if (hidden || marked.size === 0) return null;

  return (
    <div
      ref={layer}
      className="nx-visitor-unreadable"
      {...{ [CHROME_ATTRIBUTE]: "" }}
    >
      {[...marked].map(([id, bindings], index) => {
        const place = places.get(id);
        if (place === undefined) return null;
        const tipId = `${idPrefix}-tip-${String(index)}`;
        const { outline } = place;
        return (
          <Fragment key={id}>
            {/* The block itself, outlined in the badge's amber, so at rest
                the badge plainly belongs to this block and not the one
                above it. Drawn only: the badge says it in words. */}
            <div
              className="nx-visitor-unreadable__outline"
              aria-hidden="true"
              style={{
                left: outline.x,
                top: outline.y,
                width: outline.width,
                height: outline.height,
              }}
            />
            <div
              className="nx-visitor-unreadable__badge"
              data-badge-node={id}
              // One attribute per place, so the stylesheet shapes each
              // badge's corners from its own place alone.
              data-above={place.at === "above" ? "" : undefined}
              data-inside={place.at === "inside" ? "" : undefined}
              data-below={place.at === "below" ? "" : undefined}
              data-tip-start={place.tipFromStart ? "" : undefined}
              data-dismissed={dismissed === id ? "" : undefined}
              style={{ left: place.right, top: place.top }}
              onMouseLeave={() => {
                if (dismissed === id) setDismissed(null);
              }}
            >
              <button
                type="button"
                className="nx-visitor-unreadable__button"
                aria-describedby={tipId}
                onClick={() => onSelect?.(id)}
                onBlur={() => {
                  if (dismissed === id) setDismissed(null);
                }}
                onKeyDown={event => {
                  // Put the tooltip away without moving focus or the pointer.
                  if (event.key === "Escape" && dismissed !== id) {
                    event.stopPropagation();
                    setDismissed(id);
                  }
                }}
              >
                <EyeOff size={12} aria-hidden="true" />
                <span>{VISITOR_UNREADABLE_WORDS}</span>
              </button>
              <span
                id={tipId}
                role="tooltip"
                className="nx-visitor-unreadable__tip"
              >
                {bindings.map(binding => (
                  <span
                    key={binding.prop}
                    className="nx-visitor-unreadable__line"
                  >
                    <VisitorUnreadableLine
                      binding={binding}
                      readMedia={readMedia}
                      pictured
                    />
                  </span>
                ))}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
