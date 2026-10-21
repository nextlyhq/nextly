/**
 * The arrangement a reader is editing, as pure data.
 *
 * Separated from the grid that draws it because every rule here is decidable
 * without a DOM — where a card lands after a move, whether it can move at all,
 * what a newly added one starts as — and a rule that needs a rendered tree to
 * test is a rule nobody tests at the edges.
 *
 * ## One ordered list, addressed by id
 *
 * The dashboard is a single list and a card's position is its index. The list
 * a reader edits holds more than they can see, though: a REMOVED card stays in
 * it (so it can be put back where it was), and so does a card whose widget
 * this admin cannot draw. Every rule below therefore addresses a card by its
 * placement ID and counts positions among the cards that are DRAWN, never by an
 * index into what is on screen: an index into the drawn view is not an index
 * into the list, and acting on one moves the wrong card.
 *
 * @module components/features/widgets/layout-editor
 */

import { MAX_PLACEMENTS, layoutSizeProblem } from "nextly/config";

import type {
  WidgetPlacement,
  WidgetWidth,
} from "@admin/types/dashboard/widgets";

/** The four ways a card moves from its menu. */
export type MoveDirection = "start" | "earlier" | "later" | "end";

/** Whether a placement is drawn on the grid, so positions count it. */
export type IsDrawn = (placement: WidgetPlacement) => boolean;

/** The default reading of "drawn": every card the reader has not removed. */
const notRemoved: IsDrawn = placement => !placement.removed;

/**
 * Where the card goes for each direction, as an anchor among the drawn cards
 * and the side of it the card lands on. `undefined` when the move is
 * impossible: the card is already at that end, or is not drawn at all.
 */
function moveAnchor(
  drawn: readonly WidgetPlacement[],
  index: number,
  direction: MoveDirection
): { anchorId: string; side: "before" | "after" } | undefined {
  if (index === -1) return undefined;
  const last = drawn.length - 1;
  const towardStart = direction === "start" || direction === "earlier";
  // Already at the end it is moving toward: nothing to do.
  if (towardStart ? index === 0 : index === last) return undefined;
  const target = { start: 0, earlier: index - 1, later: index + 1, end: last }[
    direction
  ];
  return {
    anchorId: drawn[target].id,
    side: towardStart ? "before" : "after",
  };
}

/**
 * Moves one card in `direction`, and returns a NEW array.
 *
 * The card lands beside a DRAWN neighbour, so a removed card or one this admin
 * cannot draw is stepped over rather than swapped with: swapping with a card
 * nobody can see is a press of Move earlier that changes nothing on screen.
 * Every card not moved keeps its order relative to the others, removed cards
 * included, so restoring one later still puts it where it was.
 *
 * An impossible move returns the list unchanged: a card at the start asked to
 * move earlier is an ordinary request, not an error.
 */
export function movePlacement(
  placements: readonly WidgetPlacement[],
  placementId: string,
  direction: MoveDirection,
  isDrawn: IsDrawn = notRemoved
): WidgetPlacement[] {
  const drawn = placements.filter(isDrawn);
  const anchor = moveAnchor(
    drawn,
    drawn.findIndex(placement => placement.id === placementId),
    direction
  );
  if (anchor === undefined) return [...placements];
  const moving = placements.find(placement => placement.id === placementId);
  if (moving === undefined) return [...placements];
  const rest = placements.filter(placement => placement.id !== placementId);
  const at = rest.findIndex(placement => placement.id === anchor.anchorId);
  rest.splice(anchor.side === "before" ? at : at + 1, 0, moving);
  return rest;
}

/** Moves one card before every other drawn card. */
export function moveToStart(
  placements: readonly WidgetPlacement[],
  placementId: string,
  isDrawn?: IsDrawn
): WidgetPlacement[] {
  return movePlacement(placements, placementId, "start", isDrawn);
}

/** Moves one card before the drawn card in front of it. */
export function moveEarlier(
  placements: readonly WidgetPlacement[],
  placementId: string,
  isDrawn?: IsDrawn
): WidgetPlacement[] {
  return movePlacement(placements, placementId, "earlier", isDrawn);
}

/** Moves one card after the drawn card behind it. */
export function moveLater(
  placements: readonly WidgetPlacement[],
  placementId: string,
  isDrawn?: IsDrawn
): WidgetPlacement[] {
  return movePlacement(placements, placementId, "later", isDrawn);
}

/** Moves one card after every other drawn card. */
export function moveToEnd(
  placements: readonly WidgetPlacement[],
  placementId: string,
  isDrawn?: IsDrawn
): WidgetPlacement[] {
  return movePlacement(placements, placementId, "end", isDrawn);
}

/**
 * Which of the four moves a card may offer.
 *
 * Answered by the same anchor rule the move itself uses, so a menu item is
 * enabled exactly when pressing it would move the card.
 */
export function moveAvailability(
  placements: readonly WidgetPlacement[],
  placementId: string,
  isDrawn: IsDrawn = notRemoved
): Record<MoveDirection, boolean> {
  const drawn = placements.filter(isDrawn);
  const index = drawn.findIndex(placement => placement.id === placementId);
  const can = (direction: MoveDirection) =>
    moveAnchor(drawn, index, direction) !== undefined;
  return {
    start: can("start"),
    earlier: can("earlier"),
    later: can("later"),
    end: can("end"),
  };
}

/**
 * A card's one-based position among the drawn cards, and how many there are.
 *
 * What a move is announced in: "moved from 2 to 5 of 9" counts the cards the
 * reader can see, not the list behind them.
 */
export function drawnPosition(
  placements: readonly WidgetPlacement[],
  placementId: string,
  isDrawn: IsDrawn = notRemoved
): { position: number; count: number } | undefined {
  const drawn = placements.filter(isDrawn);
  const index = drawn.findIndex(placement => placement.id === placementId);
  return index === -1
    ? undefined
    : { position: index + 1, count: drawn.length };
}

/**
 * Moves the card `fromId` to the position `toId` holds, and returns a NEW
 * array. What a drag does when it is dropped onto another card.
 *
 * By IDENTITY: dnd-kit reports both ends of a drag as ids, and ids survive the
 * filtering between the list and the grid where indices do not.
 */
export function movePlacementTo(
  placements: readonly WidgetPlacement[],
  fromId: string,
  toId: string
): WidgetPlacement[] {
  const from = placements.findIndex(placement => placement.id === fromId);
  const to = placements.findIndex(placement => placement.id === toId);
  // An id the list does not know is an ordinary outcome — a drag released over
  // nothing, a stale row — rather than an error worth throwing over.
  if (from === -1 || to === -1 || from === to) return [...placements];
  const next = [...placements];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Sets one card's width, if its widget allows that width.
 *
 * 🔴 Refused here rather than only by the menu offering the allowed widths: the
 * server refuses a CHANGED width its widget does not allow, so a draft holding
 * one could never be saved, and the reader would meet a failure naming nothing
 * they did. Without the widget's allowed widths there is nothing to check
 * against, so nothing is set.
 */
export function setPlacementWidth(
  placements: readonly WidgetPlacement[],
  placementId: string,
  width: WidgetWidth,
  allowed: readonly WidgetWidth[] | undefined
): WidgetPlacement[] {
  if (!allowed?.includes(width)) return [...placements];
  return placements.map(placement =>
    placement.id === placementId ? { ...placement, width } : placement
  );
}

/**
 * Takes one card off the dashboard, KEEPING it in the list.
 *
 * Its place, width and settings stay, so restoring it puts back the card the
 * reader removed rather than a fresh one at the end.
 */
export function removePlacement(
  placements: readonly WidgetPlacement[],
  placementId: string
): WidgetPlacement[] {
  return placements.map(placement =>
    placement.id === placementId ? { ...placement, removed: true } : placement
  );
}

/** Puts a removed card back, exactly where it was. */
export function restorePlacement(
  placements: readonly WidgetPlacement[],
  placementId: string
): WidgetPlacement[] {
  return placements.map(placement =>
    placement.id === placementId ? { ...placement, removed: false } : placement
  );
}

/**
 * Records what a reader chose for ONE card.
 *
 * 🔴 Replaces the whole `config` rather than merging into it, because a merge
 * cannot express clearing a setting: a reader who empties a field would send
 * a key whose value is absent, and merging leaves the old value in place. The
 * caller holds the full answer for that card — the settings form knows every
 * field it drew — so replacement is the honest write.
 *
 * An EMPTY object is stored as no config at all. `resolveWidgetSettings` reads
 * a missing config and an empty one identically, so keeping `{}` would be a
 * difference the layout carries and nothing can observe — and it would make
 * `hasChanges` report a card as edited for having been opened.
 */
export function setPlacementConfig(
  placements: readonly WidgetPlacement[],
  placementId: string,
  config: Record<string, unknown>
): WidgetPlacement[] {
  const empty = Object.keys(config).length === 0;
  return placements.map(placement => {
    if (placement.id !== placementId) return placement;
    if (empty) {
      const { config: _dropped, ...rest } = placement;
      return rest;
    }
    return { ...placement, config };
  });
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
 * The id a newly added card is given.
 *
 * The WIDGET's id for the first card of a widget, when no card already holds
 * that id: it is the id the default dashboard gives the same card, so a card
 * added back is the card the default would have drawn. Any later card of the
 * same widget, or one whose natural id is taken, gets a fresh id, because ids
 * are unique within a layout and the server refuses a repeat.
 */
export function addedPlacementId(
  placements: readonly WidgetPlacement[],
  widgetId: string
): string {
  const taken = placements.some(
    placement => placement.widgetId === widgetId || placement.id === widgetId
  );
  return taken ? newPlacementId() : widgetId;
}

/**
 * Adds a widget at the end of the arrangement, at its default width.
 *
 * At the END, deliberately, rather than at a declared position. A reader who
 * adds a card has just chosen it, and putting it where the plugin thinks it
 * belongs hides it somewhere in the middle of a dashboard they have already
 * arranged — so the one place they will certainly look is where it goes.
 */
export function addPlacement(
  placements: readonly WidgetPlacement[],
  widgetId: string,
  defaultWidth: WidgetWidth,
  /**
   * The new card's id, when the caller has to know it before the list changes (to highlight
   * the card, or to move focus to it). Decided by {@link addedPlacementId} otherwise.
   */
  id: string = addedPlacementId(placements, widgetId)
): WidgetPlacement[] {
  // 🔴 REFUSED at capacity, and refused HERE rather than only at the control.
  // `MAX_PLACEMENTS` is what the layout endpoint accepts in one submission --
  // removed cards included, since they travel with the list -- so an unguarded
  // add built a draft the server was always going to reject.
  if (placements.length >= MAX_PLACEMENTS) return [...placements];
  // A decided id that is already taken is an add made twice before the list moved on (a
  // double click): adding it again would give two cards one id, so the second adds nothing.
  if (placements.some(placement => placement.id === id)) return [...placements];
  return [
    ...placements,
    {
      id,
      widgetId,
      width: defaultWidth,
      removed: false,
    },
  ];
}

/**
 * Whether two stored configs hold the same values.
 *
 * By VALUE, not by identity and not by serialised text. The draft's config is
 * rebuilt from the form on every save, so identity always differs; and
 * `JSON.stringify` is key-ORDER sensitive, so a config the server returned in
 * one order and the form rebuilt in another would compare as changed and leave
 * Save enabled on a card nobody touched.
 */
function sameConfig(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return sameItems(a, b);
  if (isRecord(a) && isRecord(b)) return sameEntries(a, b);
  return false;
}

/** Whether two arrays hold equal values in the same order. */
function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((it, i) => sameConfig(it, b[i]));
}

/** Whether two records carry the same keys, each holding an equal value. */
function sameEntries(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  // `hasOwn` rather than an index check: a config key comes from a plugin's
  // setting name, and `b["__proto__"]` answers on any ordinary object.
  return keys.every(key => Object.hasOwn(b, key) && sameConfig(a[key], b[key]));
}

/** A non-null object that is not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A placement reduced to the values a comparison should see.
 *
 * 🔴 The return type names EVERY field of `WidgetPlacement`, so the compiler
 * refuses a field added to the placement and not normalised here: a field left
 * out compares as untouched, and the reader is left looking at a change with
 * Save disabled. An emptied config is DROPPED rather than stored as `{}`, so
 * absent and empty compare equal.
 */
function comparable(
  placement: WidgetPlacement
): Record<keyof WidgetPlacement, unknown> {
  return {
    id: placement.id,
    widgetId: placement.widgetId,
    width: placement.width,
    removed: placement.removed,
    config: placement.config ?? {},
  };
}

/**
 * The arrangement a save may carry: as it is while the endpoint would accept
 * it, otherwise less its REMOVED cards, latest first, until it would.
 *
 * A stored arrangement can hold more than one save may carry: cards kept
 * while a reader could not see them come back when access returns. Remove
 * keeps a card (its width and settings, for Undo and for adding it back), so
 * without this such a reader could never save again. "Fits" is the endpoint's
 * own `layoutSizeProblem`, by count and by bytes, not a copy of it. Only
 * cards the reader has taken off the dashboard are shed, so nothing they can
 * see is lost; if the cards still on the dashboard are themselves too large,
 * the list is sent as it is and the server says why.
 */
export function withinSubmissionLimit(
  placements: readonly WidgetPlacement[]
): readonly WidgetPlacement[] {
  if (layoutSizeProblem(placements) === undefined) return placements;
  // Past the count, every shed card is measured again; this runs only for a
  // save the endpoint would otherwise refuse.
  const shed = new Set<WidgetPlacement>();
  for (let i = placements.length - 1; i >= 0; i -= 1) {
    if (!placements[i].removed) continue;
    shed.add(placements[i]);
    if (placements.length - shed.size > MAX_PLACEMENTS) continue;
    const kept = placements.filter(placement => !shed.has(placement));
    if (layoutSizeProblem(kept) === undefined) return kept;
  }
  return placements;
}

/**
 * Whether the reader has changed anything worth saving.
 *
 * Compared in ORDER, field by field — not by reference, because every editor
 * operation returns new objects and a reference check would report a change
 * for a move that put a card back where it started.
 */
export function hasChanges(
  original: readonly WidgetPlacement[],
  edited: readonly WidgetPlacement[]
): boolean {
  if (original.length !== edited.length) return true;
  return original.some(
    (placement, index) =>
      !sameConfig(comparable(placement), comparable(edited[index]))
  );
}
