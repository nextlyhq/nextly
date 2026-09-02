/**
 * The arrangement a reader is editing, as pure data.
 *
 * Separated from the grid that draws it because every rule here is decidable
 * without a DOM — where a card lands after a move, whether it can move at all,
 * what a newly added one inherits — and a rule that needs a rendered tree to
 * test is a rule nobody tests at the edges.
 *
 * ## The order field is not the array index
 *
 * Placements arrive sorted by `order`, and `order` is a sparse number so a card
 * can be inserted between two neighbours without renumbering them. The editor
 * works on the ARRAY, because that is what a reader manipulates, and
 * renumbers on the way out — so nothing in the UI has to reason about gaps, and
 * nothing stored ever depends on an index that a filter could shift.
 *
 * @module components/features/widgets/layout-editor
 */

import type { WidgetPlacement } from "@admin/types/dashboard/widgets";

/** The gap left between saved positions, so one can be inserted between two. */
const ORDER_STEP = 10;

/** Where a card can move, given where it already is. */
export interface MoveAffordance {
  canMoveUp: boolean;
  canMoveDown: boolean;
}

/**
 * Moves the placement identified by `fromId` to the position currently held by
 * `toId`, and returns a NEW array.
 *
 * 🔴 By IDENTITY, not by index, and the difference is a real defect rather than
 * a preference. The grid draws a FILTERED view — a placement whose declaration
 * this admin cannot resolve is skipped — so a position in what the reader sees
 * is not a position in what is stored. With `[A, unresolvable, B]` the reader
 * sees `[A, B]`, and moving `B` up by view-index 1 moved the UNRESOLVABLE
 * placement while `B` stayed put, then persisted that order.
 *
 * Ids survive filtering; indices do not. Both callers already hold ids — the
 * drag handler gets them from dnd-kit, and the buttons read them off the row
 * they are rendered for — so nothing has to translate.
 */
export function movePlacementTo(
  placements: readonly WidgetPlacement[],
  fromId: string,
  toId: string
): WidgetPlacement[] {
  const from = placements.findIndex(placement => placement.id === fromId);
  const to = placements.findIndex(placement => placement.id === toId);
  // An id neither list knows is an ordinary outcome — a drag released over
  // nothing, a stale row — rather than an error worth throwing over.
  if (from === -1 || to === -1) return [...placements];
  return movePlacement(placements, from, to);
}

/**
 * Moves the placement at `from` to `to`, and returns a NEW array.
 *
 * Out-of-range indices return the input unchanged rather than throwing. A drag
 * that ends outside the list and a keyboard move at the last position are both
 * ordinary gestures, not errors, and a throw here would take the grid down over
 * one of them.
 */
export function movePlacement(
  placements: readonly WidgetPlacement[],
  from: number,
  to: number
): WidgetPlacement[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= placements.length ||
    to >= placements.length
  ) {
    return [...placements];
  }
  const next = [...placements];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Whether the card at `index` has anywhere to go. */
export function moveAffordance(index: number, count: number): MoveAffordance {
  return { canMoveUp: index > 0, canMoveDown: index >= 0 && index < count - 1 };
}

/**
 * Puts a card away, or brings it back.
 *
 * `hidden` rather than removal, and the two are genuinely different: a hidden
 * placement KEEPS its position and its config, so bringing it back restores the
 * arrangement rather than appending it to the end. Removal is what the reader
 * does when they want it gone; hiding is what they do when they want it later.
 */
export function togglePlacementHidden(
  placements: readonly WidgetPlacement[],
  placementId: string
): WidgetPlacement[] {
  return placements.map(placement =>
    placement.id === placementId
      ? { ...placement, hidden: !placement.hidden }
      : placement
  );
}

/** Drops a card from the arrangement entirely. */
export function removePlacement(
  placements: readonly WidgetPlacement[],
  placementId: string
): WidgetPlacement[] {
  return placements.filter(placement => placement.id !== placementId);
}

/**
 * A fresh placement id.
 *
 * `crypto.randomUUID` where it exists, and a counter-plus-random fallback where
 * it does not — jsdom without a secure context, and older browsers, both leave
 * it undefined. The fallback does not need to be unguessable: this id is opaque
 * within one arrangement and is never a secret, so uniqueness is the whole
 * requirement.
 */
let fallbackCounter = 0;
export function newPlacementId(): string {
  const generator = globalThis.crypto;
  if (typeof generator?.randomUUID === "function") {
    return generator.randomUUID();
  }
  fallbackCounter += 1;
  return `placement-${Date.now()}-${fallbackCounter}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/**
 * Adds a widget to the end of the arrangement.
 *
 * At the END, deliberately, rather than at its declared position. A reader who
 * adds a card has just chosen it, and putting it where the plugin thinks it
 * belongs hides it somewhere in the middle of a dashboard they have already
 * arranged — so the one place they will certainly look is where it goes.
 *
 * The geometry comes from the widget's own declaration, so an added card is the
 * size its author intended rather than an arbitrary default.
 */
export function addPlacement(
  placements: readonly WidgetPlacement[],
  widgetId: string,
  geometry?: { size?: string; height?: string }
): WidgetPlacement[] {
  const last = placements[placements.length - 1];
  return [
    ...placements,
    {
      id: newPlacementId(),
      widgetId,
      order: last ? last.order + ORDER_STEP : 0,
      hidden: false,
      ...(geometry?.size === undefined ? {} : { size: geometry.size }),
      ...(geometry?.height === undefined ? {} : { height: geometry.height }),
    },
  ];
}

/**
 * The array as it will be STORED: positions renumbered from the current order.
 *
 * 🔴 Renumbered rather than sent as-is. The editor reorders an array, so a
 * moved card carries whatever `order` it had before — send that and the server
 * sorts by a number that no longer matches what the reader sees, and their
 * arrangement comes back rearranged. Sparse steps rather than 0..n so a later
 * insertion between two cards needs no renumbering at all.
 */
export function renumber(
  placements: readonly WidgetPlacement[]
): WidgetPlacement[] {
  return placements.map((placement, index) => ({
    ...placement,
    order: index * ORDER_STEP,
  }));
}

/**
 * Whether the reader has changed anything worth saving.
 *
 * Compared on the fields that are STORED, in order — not by reference, because
 * every editor operation returns new objects and a reference check would report
 * a change for a move that put a card back where it started.
 */
export function hasChanges(
  original: readonly WidgetPlacement[],
  edited: readonly WidgetPlacement[]
): boolean {
  if (original.length !== edited.length) return true;
  return renumber(original).some((placement, index) => {
    const other = renumber(edited)[index];
    return (
      placement.id !== other.id ||
      placement.widgetId !== other.widgetId ||
      placement.order !== other.order ||
      placement.hidden !== other.hidden ||
      placement.size !== other.size ||
      placement.height !== other.height
    );
  });
}
