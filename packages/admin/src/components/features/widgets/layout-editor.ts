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

import { MAX_PLACEMENTS } from "nextly/config";

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
  // 🔴 REFUSED at capacity, and refused HERE rather than only at the control.
  // `MAX_PLACEMENTS` is what the layout endpoint accepts in one submission, and
  // an install declaring more widgets than that offers the surplus through
  // `available` -- so an unguarded add built a draft the server was always
  // going to reject, and the reader met a generic "could not be saved" naming
  // no limit they knew they had reached.
  //
  // A disabled button explains; it does not guarantee. This is the one path
  // every add takes, and it is a pure function, so the guarantee is stated
  // where it can be asserted directly rather than through a control that has
  // to be reachable to be tested.
  if (placements.length >= MAX_PLACEMENTS) return [...placements];
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

/** Whether a card at `column` may move left or right, given the count. */
export interface ColumnAffordance {
  canMoveLeft: boolean;
  canMoveRight: boolean;
}

/**
 * The placements of each column, in reading order, one bucket per column.
 *
 * 🔴 Always `columnCount` buckets, including empty ones. A column exists as a
 * drop target only because the grid renders it, so collapsing an empty bucket
 * would make a column unreachable the moment its last card left — the reader
 * could move a card out of column 3 and never move one back.
 *
 * A card whose column is out of range is KEPT, folded into the last column
 * rather than dropped. Narrowing the dashboard is a presentation change and the
 * cards in the columns that went away are still the reader's; showing one
 * somewhere unexpected is recoverable, deleting it is not.
 */
export function placementsByColumn(
  placements: readonly WidgetPlacement[],
  columnCount: number
): WidgetPlacement[][] {
  const columns: WidgetPlacement[][] = Array.from(
    { length: Math.max(1, columnCount) },
    () => []
  );
  for (const placement of placements) {
    const declared = placement.column ?? 0;
    const index = Math.min(Math.max(0, declared), columns.length - 1);
    columns[index].push(placement);
  }
  return columns.map(column => [...column].sort((a, b) => a.order - b.order));
}

/**
 * The same placements, with one card moved into `column`.
 *
 * Identified by id rather than by position, for the reason `movePlacementTo`
 * gives: a view index means something different from a stored index the moment
 * one placement is unresolvable, and translating between them moved the wrong
 * card. An id nobody holds is an ordinary outcome, not an error.
 */
export function moveToColumn(
  placements: readonly WidgetPlacement[],
  placementId: string,
  column: number
): WidgetPlacement[] {
  return placements.map(placement =>
    placement.id === placementId
      ? { ...placement, column: Math.max(0, column) }
      : placement
  );
}

/**
 * Which sideways moves a card may offer.
 *
 * 🔴 These back the CLICKABLE controls, not the drag. WCAG 2.2 SC 2.5.7 says
 * functionality reachable by dragging must also be reachable with a single
 * pointer, and states that a keyboard equivalent does not satisfy it on its
 * own. Crossing columns is new functionality, so it arrives with its buttons or
 * it regresses the conformance `WidgetEditControls` already argues for.
 */
export function columnAffordance(
  column: number,
  columnCount: number
): ColumnAffordance {
  return {
    canMoveLeft: column > 0,
    canMoveRight: column < columnCount - 1,
  };
}
