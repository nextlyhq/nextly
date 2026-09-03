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
      // 🔴 The LAST placement's column, not the missing-column fallback of 0.
      // `addPlacement` appends, and the picker sits below the grid — landing a
      // new card at the top of column 0 puts it above everything the reader
      // was looking at, which reads as the button having done nothing.
      column: last?.column ?? 0,
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
      // 🔴 `column` is the only field a sideways move touches. Left out, an
      // arrangement whose cards changed columns compares as untouched, Save
      // stays disabled, and the reader watches work they can see refuse to
      // persist.
      (placement.column ?? 0) !== (other.column ?? 0) ||
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
export function placementsByColumn<
  T extends { column?: number; order: number },
>(placements: readonly T[], columnCount: number): T[][] {
  const columns: T[][] = Array.from(
    { length: Math.max(1, columnCount) },
    () => []
  );
  for (const placement of placements) {
    // 🔴 TRUNCATED, because this value indexes an array. A fractional column
    // survives the clamp and `columns[0.5]` is undefined, so the push throws
    // and takes the whole grid with it. The reader that builds a stored
    // placement truncates already, so nothing reaches here fractional today —
    // which is what makes the guard cheap rather than what makes it
    // unnecessary: this is exported, it is called on placements from the
    // editor as well as from the wire, and reachability is a property of the
    // call graph rather than of the code.
    const declared = Math.trunc(placement.column ?? 0);
    const index = Math.min(Math.max(0, declared), columns.length - 1);
    columns[index].push(placement);
  }
  return columns.map(column => [...column].sort((a, b) => a.order - b.order));
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

/**
 * The droppable id for a column.
 *
 * 🔴 A NUMBER, and that is the whole of the guarantee. dnd-kit keys its
 * droppable registry by id alone, so a string id shared with a placement makes
 * one registration replace the other before any metadata can be read — the
 * card becomes undroppable or the column misclassifies, depending on which
 * registered last. Placement ids are always strings, so a numeric id cannot
 * collide with one at all.
 *
 * The offset keeps a column id away from any numeric id another surface might
 * register in the same context.
 */
export function columnDropId(column: number): number {
  return COLUMN_DROP_ID_BASE + column;
}

/** Where column droppable ids start. */
const COLUMN_DROP_ID_BASE = 1_000_000;

/** Which side of a card a drop lands on. */
export type DropSide = "before" | "after";

/** What a drag was released over. */
export type DropTarget =
  | { kind: "column"; column: number }
  | { kind: "card"; placementId: string; side: DropSide };

/**
 * Which side of the card under the pointer a drop lands on.
 *
 * 🔴 Consulted only where a drop CROSSES columns, which is the case with no
 * index in the destination to compare against. It is what makes the bottom of
 * another column reachable: that column's own droppable covers only the space
 * its cards leave, so a release below its last card resolves to the card, and
 * a drop landing at the target's own index arrives in front of it. Within one
 * column the two indices decide instead, because the rectangles a keyboard
 * drag produces are identical and cannot say — see `resolveDrop`.
 *
 * Compared on vertical centres, because a column is a vertical list: past the
 * middle of the card underneath, the reader is aiming below it. The dragged
 * rectangle is the TRANSLATED one, which is where the card currently is rather
 * than where the gesture started.
 *
 * Defaults to `before` when either rectangle is missing. That is the position a
 * drop resolved to before sides existed, so a measurement this cannot take
 * costs the old behaviour rather than an arbitrary one.
 */
export function dropSide(
  active: { top: number; height: number } | null | undefined,
  over: { top: number; height: number } | null | undefined
): DropSide {
  if (!active || !over) return "before";
  return active.top + active.height / 2 > over.top + over.height / 2
    ? "after"
    : "before";
}

/**
 * The droppable data a column registers.
 *
 * 🔴 The KIND travels in dnd-kit's `data`, not in the shape of the id. Columns
 * and cards share one id space, so a placement is free to be called
 * `widget-column:1` -- ids are opaque, the layout API accepts any non-empty
 * string, and a widget id becomes a default placement id under no prefix rule
 * at all. Any rule that reads the string has to guess which of the two a
 * collision meant; data cannot collide, because only a column carries it.
 */
export interface ColumnDropData {
  widgetColumn: number;
}

/** The column a droppable's data names, or `undefined` when it names a card. */
export function columnFromDropData(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const column = (data as { widgetColumn?: unknown }).widgetColumn;
  return typeof column === "number" && Number.isInteger(column) && column >= 0
    ? column
    : undefined;
}

/**
 * The arrangement after a card was dropped somewhere.
 *
 * Two kinds of target, because a column needs both. Dropping onto a CARD takes
 * that card's column and lands beside it, which is how a reader orders one
 * widget above another. Dropping onto the COLUMN itself is the only way to
 * reach an empty one -- it holds no card to aim at, so without this a column
 * becomes unreachable the moment its last card leaves.
 *
 * A drop that resolves to nothing returns the arrangement unchanged. Released
 * over empty space, or onto itself, is an ordinary end to a drag rather than an
 * error worth reporting.
 *
 * 🔴 This is the ONLY way a card changes column, and the single-pointer
 * controls go through it too rather than through a helper of their own. A
 * second one that set `column` and left `order` alone would move the card
 * correctly and leave the stored sequence column-major — the exact disagreement
 * with `byPosition` that `rowMajor` below exists to prevent.
 */
/**
 * Where a drop lands: which bucket, and the index in it.
 *
 * 🔴 The index names a position in the bucket as it stands BEFORE the active
 * card is taken out, and the single adjustment for that removal belongs to the
 * caller. A branch that compensated for it here would compensate twice.
 *
 * `undefined` when the target names a card no bucket holds, which is an
 * ordinary end to a drag rather than an error.
 */
function landingSlot(
  buckets: readonly WidgetPlacement[][],
  target: DropTarget,
  from: number,
  fromIndex: number
): { column: number; insertAt: number } | undefined {
  if (target.kind === "column") {
    // A column target is the empty-column case, so the card appends.
    const column = Math.min(Math.max(0, target.column), buckets.length - 1);
    return { column, insertAt: buckets[column].length };
  }

  const column = buckets.findIndex(bucket =>
    bucket.some(p => p.id === target.placementId)
  );
  if (column === -1) return undefined;
  const targetIndex = buckets[column].findIndex(
    p => p.id === target.placementId
  );

  // 🔴 Within ONE column the two indices already say which way the card is
  // going, and the side is not consulted. The keyboard sensor lands the active
  // card exactly ON its target, so the rectangles a side is measured from are
  // identical and answer "before" for a move that is plainly downward — which
  // cancels against the caller's removal adjustment and makes Space,
  // ArrowDown, Space do nothing for two cards of equal height.
  //
  // ACROSS columns there is no index in the destination to compare against, so
  // the measured side is the only thing separating "above this card" from
  // "below it" — and without it the position after a populated column's last
  // card cannot be reached at all.
  const offset =
    from === column
      ? Number(fromIndex < targetIndex)
      : Number(target.side === "after");
  return { column, insertAt: targetIndex + offset };
}

export function resolveDrop(
  placements: readonly WidgetPlacement[],
  activeId: string,
  target: DropTarget | null,
  columnCount: number
): WidgetPlacement[] {
  if (target === null) return [...placements];
  if (target.kind === "card" && target.placementId === activeId) {
    return [...placements];
  }
  const active = placements.find(p => p.id === activeId);
  if (active === undefined) return [...placements];

  // 🔴 Resolved inside the DESTINATION COLUMN's bucket, not against the
  // interleaved whole. Reordering the flat sequence cannot express a middle
  // position: with `[A(0), B(1), C(2), D(0)]`, moving B toward A lands it
  // before A and moving it toward D lands it after D, so `[A, B, D]` is
  // unreachable however the pointer is placed. Column 0 is `[A, D]` and B goes
  // at D's index, which is the position the reader aimed at.
  const buckets = placementsByColumn(placements, columnCount);

  const from = buckets.findIndex(bucket => bucket.some(p => p.id === activeId));
  if (from === -1) return [...placements];
  const fromIndex = buckets[from].findIndex(p => p.id === activeId);

  const slot = landingSlot(buckets, target, from, fromIndex);
  if (slot === undefined) return [...placements];
  const { column } = slot;
  let { insertAt } = slot;

  buckets[from].splice(fromIndex, 1);
  // 🔴 The removal shifts every later index down by one, so a card moving DOWN
  // past a neighbour in its OWN column would be re-inserted in front of it and
  // nothing would move. Across columns nothing shifted, so nothing is adjusted.
  if (from === column && fromIndex < insertAt) insertAt -= 1;
  buckets[column].splice(insertAt, 0, { ...active, column });

  return rowMajor(buckets);
}

/**
 * The buckets as ONE sequence, read ACROSS the rows.
 *
 * 🔴 Row-major, not column by column. `byPosition` is the single order in which
 * the API presents a placement list as a line, and it reads the dashboard the
 * way a person does: across the top, then the next row down. Numbering column
 * by column made the stored `order` disagree with that — an arrangement drawn
 * as `[A, D] [B] [C]` was stored as `A, D, B, C` while the reader sees
 * `A, B, C, D` — so every client consuming the canonical sequence reordered
 * cards nobody had moved.
 *
 * Sparse steps rather than 0..n, for the reason `renumber` gives: an insertion
 * between two cards then needs no renumbering at all.
 */
/**
 * The arrangement as it will be STORED, for the column count in force.
 *
 * 🔴 Bucketed at that count BEFORE the orders are assigned, because the count
 * decides which cards share a column and therefore what the row-major reading
 * is. Renumbering the array instead numbers the sequence the cards happened to
 * be in: narrowing four columns to two folds two of them into the last, so the
 * stored sequence keeps a reading of a grid that is no longer on screen, and
 * the canonical order disagrees with the arrangement until the next drag.
 */
export function renumberForColumns(
  placements: readonly WidgetPlacement[],
  columnCount: number
): WidgetPlacement[] {
  return rowMajor(placementsByColumn(placements, columnCount));
}

function rowMajor(buckets: readonly WidgetPlacement[][]): WidgetPlacement[] {
  const depth = buckets.reduce(
    (deepest, bucket) => Math.max(deepest, bucket.length),
    0
  );
  const sequence: WidgetPlacement[] = [];
  for (let row = 0; row < depth; row += 1) {
    for (const bucket of buckets) {
      const placement = bucket[row];
      if (placement !== undefined) sequence.push(placement);
    }
  }
  return sequence.map((placement, index) => ({
    ...placement,
    order: index * ORDER_STEP,
  }));
}

/**
 * Whether a draft differs from what was last saved.
 *
 * 🔴 Both halves, because a reader can change either alone. Moving a card
 * sideways touches only its `column`; switching 3 columns to 2 touches no
 * placement at all. A check that asked about placements only would leave Save
 * disabled on an arrangement the reader is looking at and has plainly changed,
 * which reads as the dashboard refusing to keep their work.
 */
export function draftDiffers(
  saved: readonly WidgetPlacement[],
  savedColumnCount: number,
  draft: readonly WidgetPlacement[],
  draftColumnCount: number
): boolean {
  return hasChanges(saved, draft) || savedColumnCount !== draftColumnCount;
}
