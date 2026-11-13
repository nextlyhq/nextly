"use client";

/**
 * The height a card holds while its data loads: the height it was last drawn at with an answer.
 *
 * A card is as tall as its content, so a card whose answer has not arrived has no height of its
 * own beyond its loading skeleton's, and the cards below it would move when the answer lands.
 * Each cell remembers the height its card was last drawn at with an answer, by placement and by
 * how wide the cell was; while the card loads again (a return to the dashboard, a refresh, a card
 * put back, a fresh tab) the cell is drawn at exactly that height ({@link heldCellStyle}). The
 * heights are kept on the device (`rememberLayout`, numbers alone, forgotten with the person and
 * by the site's switch), so the first paint of a fresh tab holds them too, and in this page's
 * memory, which holds them for the page where the device keeps nothing. A card never drawn with
 * an answer holds its skeleton's height, the default for its kind (`WidgetCard`'s loading body).
 *
 * @module components/features/widgets/frame/held-height
 */

import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";

import {
  deviceMemoryRevision,
  forgetLayoutParts,
  onDeviceMemoryChange,
  recallLayoutParts,
  rememberLayout,
} from "@admin/lib/device-memory/device-memory";

import { observeSize } from "./observe-size";

/**
 * How near a kept width must be to the cell's for its height to be held: half a band of 32px
 * either side. A card's height follows its width (its rows wrap), so a height is held only for
 * a cell about as wide as the one it was drawn in; measured against the width it was drawn at,
 * not a fixed band, so a hair's difference (a scrollbar, a subpixel) never misses it.
 */
const WIDTH_TOLERANCE_PX = 16;

/**
 * How many widths a placement keeps a height for: the most recent few. A window resized across
 * many widths would otherwise add one per width and crowd every other kept size out.
 */
const WIDTHS_KEPT_PER_PLACEMENT = 3;

/** The prefix every height a placement keeps is named under. */
function placementPrefix(placementId: string): string {
  return `card-height:${placementId}:`;
}

/** The name a placement's height is kept under, at a cell of `width` pixels, to a tenth. */
function heightPart(placementId: string, width: number): string {
  return `${placementPrefix(placementId)}${Math.round(width * 10) / 10}`;
}

/** The width a kept part was drawn at. */
function widthOf(part: string): number {
  return Number(part.slice(part.lastIndexOf(":") + 1));
}

/** The heights this page has drawn, by the name each is kept under. */
const drawnHeights = new Map<string, number>();

/** The kept heights of `placementId`: this page's over the device's, by part. */
function keptFor(placementId: string): Map<string, number> {
  const prefix = placementPrefix(placementId);
  const kept = new Map(Object.entries(recallLayoutParts(prefix)));
  for (const [part, height] of drawnHeights) {
    if (part.startsWith(prefix)) kept.set(part, height);
  }
  return kept;
}

/** The height kept for `placementId` at the width nearest `width`, within the tolerance. */
function heldFor(placementId: string, width: number): number | undefined {
  let nearest: { distance: number; height: number } | undefined;
  for (const [part, height] of keptFor(placementId)) {
    const distance = Math.abs(widthOf(part) - width);
    if (distance > WIDTH_TOLERANCE_PX) continue;
    if (nearest === undefined || distance < nearest.distance) {
      nearest = { distance, height };
    }
  }
  return nearest?.height;
}

/**
 * Keep `height` for `placementId` at `width`: in place of a kept width within the tolerance of
 * it, and beside at most the most recent few others, the oldest giving way.
 */
function keepHeight(placementId: string, width: number, height: number): void {
  const part = heightPart(placementId, width);
  const others = [...keptFor(placementId).keys()].filter(kept => kept !== part);
  const near = others.filter(
    kept => Math.abs(widthOf(kept) - width) <= WIDTH_TOLERANCE_PX
  );
  const far = others.filter(kept => !near.includes(kept));
  const old = new Set([
    ...near,
    ...far.slice(0, Math.max(0, far.length - (WIDTHS_KEPT_PER_PLACEMENT - 1))),
  ]);
  for (const kept of old) drawnHeights.delete(kept);
  if (old.size > 0) forgetLayoutParts(kept => old.has(kept));
  drawnHeights.set(part, height);
  rememberLayout(part, height);
}

/**
 * Forget the heights kept for every placement not in `placements`, the dashboard's cards now:
 * a card taken off the dashboard has no height to hold.
 */
export function forgetCardHeightsExcept(placements: ReadonlySet<string>): void {
  const gone = (part: string) =>
    part.startsWith("card-height:") &&
    !placements.has(part.slice("card-height:".length, part.lastIndexOf(":")));
  for (const part of drawnHeights.keys()) {
    if (gone(part)) drawnHeights.delete(part);
  }
  forgetLayoutParts(gone);
}

/**
 * Keep heights only for the dashboard's cards: once its arrangement is settled (`settled`, not
 * while it is being customised), the heights of placements no longer on it are forgotten.
 */
export function useKeptHeightsOnlyFor(
  placementIds: readonly string[],
  settled: boolean
): void {
  const key = placementIds.join("\n");
  useEffect(() => {
    if (!settled) return;
    forgetCardHeightsExcept(new Set(key === "" ? [] : key.split("\n")));
  }, [key, settled]);
}

/**
 * The height the card at `placementId` holds as its minimum while `loading`: the height it was
 * last drawn at with an answer, in a cell about this wide, or `undefined` for none. Read in a
 * layout effect, before the browser paints, where the cell's width is known, and read again
 * whenever the device memory changes (the server says who is signed in, the person is
 * forgotten, remembering is switched off), so a height the device then refuses is let go.
 * While not loading, records the cell's height (`cell`) as it changes, for the next load.
 */
export function useHeldCardHeight(
  placementId: string,
  loading: boolean,
  cell: RefObject<HTMLElement | null>
): number | undefined {
  const [held, setHeld] = useState<number | undefined>(undefined);
  const revision = useSyncExternalStore(
    onDeviceMemoryChange,
    deviceMemoryRevision,
    deviceMemoryRevision
  );
  const [seenRevision, setSeenRevision] = useState(revision);
  if (seenRevision !== revision) {
    // What this page drew was drawn for the person the device knew then.
    setSeenRevision(revision);
    drawnHeights.clear();
  }
  useLayoutEffect(() => {
    const element = cell.current;
    if (loading) {
      const width = element?.getBoundingClientRect().width ?? 0;
      setHeld(width > 0 ? heldFor(placementId, width) : undefined);
      return;
    }
    setHeld(undefined);
    if (element === null) return;
    const record = () => {
      const box = element.getBoundingClientRect();
      const height = Math.round(box.height);
      if (height <= 0 || box.width <= 0) return;
      keepHeight(placementId, box.width, height);
    };
    return observeSize(element, record);
  }, [placementId, loading, cell, revision]);
  return loading ? held : undefined;
}

/**
 * The style of a cell holding `heldPx` while its card loads: exactly that height, its skeleton
 * clipped to it. A minimum alone would let a skeleton taller than the answer it stands in for
 * grow the row while loading, and the row would close up again when the answer lands, moving
 * every card under it. Nothing for a cell that holds no height.
 */
export function heldCellStyle(
  heldPx: number | undefined
): CSSProperties | undefined {
  return heldPx === undefined
    ? undefined
    : { height: `${heldPx}px`, overflow: "hidden" };
}

/** Forgets this page's heights. For tests, which draw one placement id many times. */
export function forgetHeldCardHeights(): void {
  drawnHeights.clear();
}
