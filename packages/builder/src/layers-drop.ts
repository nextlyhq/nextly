/**
 * Where a Layers row dragged by the pointer would land, and whether it may.
 *
 * The Layers panel is a list of rows, so a drag there asks two things the
 * canvas never does: WHICH GAP between two rows the pointer is at, and HOW
 * DEEP the block should sit there. The gap comes from the pointer's height
 * against the rows; the depth from how far right the pointer has travelled.
 * Both are answered here, from measured rows and the document, so every rule
 * below is assertable without a browser — jsdom draws every row zero pixels
 * tall and could not exercise one of them.
 *
 * ## Depth is the pointer's x, one level per {@link LAYERS_DEPTH_PX}
 *
 * Measured from `left`, the x at which depth zero begins. The panel puts that
 * where the pressed row's own depth started, so a drag straight down keeps the
 * block at the depth it had, and a drag to the right nests it.
 *
 * The depth is then clamped to what the gap allows. It may be no shallower
 * than the row below the gap — anything less would leave that row with no
 * parent above it — and no deeper than one more than the row above, and that
 * only when the row above can hold blocks at all. A block dropped one level
 * deeper than the row above goes INSIDE that row; at the row's own depth or
 * less it goes after the row's ancestor at that depth.
 *
 * ## Judged by the one placement rule, and the locks
 *
 * A position the gap allows is not therefore allowed. Each is asked of
 * `canPlaceIn`, the rule a save and every other surface ask, and of the
 * editor's own lock question, the one its apply asks — so a drop is refused
 * with the rule's reason rather than offered and then undone. Their answers are
 * kept for the gesture in a {@link LayersVerdictCache}: the document, the block
 * and the sources cannot change while a drag lasts.
 *
 * @module layers-drop
 */

import {
  canPlaceIn,
  DEFAULT_SLOT,
  findNode,
  locateNode,
  type BlockDocument,
  type BlockNode,
  type PlacementRefused,
  type PlacementSources,
  type PlacementVerdict,
} from "@nextlyhq/blocks-engine";
import { TREE_INDENT_PX } from "@nextlyhq/ui";

import { placementWording, type RefusalWording } from "./drag-refusal";
import { movingSubtree } from "./drop-targets";
import type { Point } from "./geometry";
import { indentSlot } from "./keyboard-move";
import { pathTo } from "./layers";
import {
  lockedBlockWording,
  lockRefusalWording,
  type LockRefusalFacts,
} from "./lock-refusal";
import { lockBlockingMove } from "./locking";
import type { BuilderOp, OpPosition, SlotAddress } from "./op-vocabulary";

/**
 * How far right the pointer travels to nest a block one level deeper: the
 * tree's own indent, so a depth the pointer reaches is drawn exactly where a
 * row at that depth starts.
 */
export const LAYERS_DEPTH_PX: typeof TREE_INDENT_PX = TREE_INDENT_PX;

/** One row on screen, measured, with where its block sits in the document. */
export interface LayersRow {
  readonly id: string;
  /** 0 for a block at the top of the page. */
  readonly depth: number;
  /** The block's container, absent at the top of the page. */
  readonly parentId: string | undefined;
  /** The slot it sits in inside that container, absent at the top. */
  readonly slot: string | undefined;
  /** Its index in that slot. */
  readonly index: number;
  /** Whether the row is open, showing the rows of what it holds. */
  readonly expanded: boolean;
  /** Whether the block has anywhere to put a block (`holdsBlocks`). */
  readonly canHoldChildren: boolean;
  /** Where the row starts and how tall it is, in the pointer's coordinates. */
  readonly top: number;
  readonly height: number;
}

/**
 * The answers already reached in one gesture.
 *
 * Keyed by the parent id and the slot as SEPARATE map keys rather than one
 * joined string. Ids are stored data and slot names are a definition's, and
 * either may hold any character, so any separator could collide: parent `a:b`
 * slot `c` and parent `a` slot `b:c` would join to the same key and share a
 * verdict. `null` is the top of the page, which has no parent.
 *
 * The placement verdict depends on the container alone; a lock's also on the
 * index, since a slot locked to its order refuses one place and not another.
 */
export interface LayersVerdictCache {
  readonly placement: Map<string | null, Map<string, PlacementVerdict>>;
  readonly locks: Map<
    string | null,
    Map<string, Map<number, LockRefusalFacts | null>>
  >;
}

/** An empty cache, for the start of a gesture. */
export function layersVerdictCache(): LayersVerdictCache {
  return { placement: new Map(), locks: new Map() };
}

/** What the drop is judged against. */
export interface LayersPlacement {
  /** The document the drag began on. */
  readonly document: BlockDocument;
  /** Where the placement rule reads its answers (`placementSources`). */
  readonly sources: PlacementSources;
  /** The editor's own lock question, the one its apply asks. */
  readonly lockRefusalFor: (
    ops: readonly BuilderOp[]
  ) => LockRefusalFacts | undefined;
  /** The answers this gesture has already reached. */
  readonly verdicts: LayersVerdictCache;
}

/** What {@link layersDrop} reads. */
export interface LayersDropInput {
  /** The rows on screen, in order. */
  readonly rows: readonly LayersRow[];
  /** The block being dragged. */
  readonly draggedId: string;
  /** The pointer, in the rows' coordinates. */
  readonly pointer: Point;
  /** The x at which depth zero begins; see the module docblock. */
  readonly left: number;
  readonly placement: LayersPlacement;
}

/** Where the line is drawn: the gap's height, and the depth it is at. */
export interface LayersLine {
  readonly y: number;
  readonly depth: number;
}

/**
 * Why a drop is refused: the placement rule's whole answer with the two types
 * its words name, or the lock a move there would break.
 */
export type LayersRefusal =
  | {
      readonly kind: "placement";
      readonly verdict: PlacementRefused;
      readonly movingType: string;
      readonly regionType: string | undefined;
    }
  | { readonly kind: "lock"; readonly lock: LockRefusalFacts }
  /**
   * The dragged block holds a block the author locked, itself or deeper. The
   * op layer relocates no subtree holding a locked block, so this refuses
   * every place, before release rather than by an apply that does nothing.
   */
  | {
      readonly kind: "held";
      readonly locked: BlockNode;
      /** The dragged block, which the locked one is, holds or sits inside. */
      readonly movingId: string;
    };

/** What the pointer means right now. */
export type LayersDropResult =
  | { readonly kind: "none" }
  | {
      readonly kind: "drop";
      /** The move's position, in the shape the op store consumes. */
      readonly to: OpPosition;
      /** The slot the block leaves, for the store to drop if left empty. */
      readonly dropSlotIfEmpty?: SlotAddress;
      readonly line: LayersLine;
    }
  | {
      readonly kind: "refused";
      readonly refusal: LayersRefusal;
      readonly line: LayersLine;
    };

const NONE: LayersDropResult = { kind: "none" };

/**
 * The row the pointer's height is over, or `undefined` outside every row.
 *
 * Top edge in, bottom edge out, so two touching rows never both claim the
 * boundary between them.
 */
export function rowAt(
  rows: readonly LayersRow[],
  y: number
): LayersRow | undefined {
  return rows.find(row => y >= row.top && y < row.top + row.height);
}

/** The words a refusal is shown and announced with, from the shared wording. */
export function layersRefusalWording(refusal: LayersRefusal): RefusalWording {
  switch (refusal.kind) {
    case "lock":
      return lockRefusalWording(refusal.lock);
    case "held":
      return lockedBlockWording(refusal.locked, refusal.movingId);
    case "placement":
      return placementWording(
        refusal.verdict,
        refusal.movingType,
        refusal.regionType
      );
  }
}

/** The nearest row outside the dragged block, stepping from `from` by `step`. */
function nearestOutside(
  rows: readonly LayersRow[],
  from: number,
  step: 1 | -1,
  moving: ReadonlySet<string>
): LayersRow | undefined {
  for (let at = from; at >= 0 && at < rows.length; at += step) {
    const row = rows[at];
    if (row !== undefined && !moving.has(row.id)) return row;
  }
  return undefined;
}

/** A value from a two-level map, made and stored on the first ask. */
function heldIn<K, S, V>(
  outer: Map<K, Map<S, V>>,
  first: K,
  second: S,
  make: () => V
): V {
  let inner = outer.get(first);
  if (inner === undefined) {
    inner = new Map();
    outer.set(first, inner);
  }
  const held = inner.get(second);
  if (held !== undefined) return held;
  const made = make();
  inner.set(second, made);
  return made;
}

/** The position a row's block occupies now, read from the measured row. */
function positionOf(row: LayersRow): OpPosition {
  return row.parentId === undefined || row.slot === undefined
    ? { index: row.index }
    : { parentId: row.parentId, slot: row.slot, index: row.index };
}

/** The position after the block `id`, in the container it sits in. */
function positionAfter(nodes: BlockNode[], id: string): OpPosition | undefined {
  const at = locateNode(nodes, id);
  if (at === undefined) return undefined;
  return at.parent === undefined || at.slot === undefined
    ? { index: at.index + 1 }
    : { parentId: at.parent.id, slot: at.slot, index: at.index + 1 };
}

/** The gap the pointer is at: the rows either side of it, outside the block. */
interface Gap {
  readonly above: LayersRow | undefined;
  readonly below: LayersRow | undefined;
  /** Where the line is drawn for it. */
  readonly y: number;
}

/**
 * The position a gap and a depth name, before the dragged block is lifted out.
 *
 * Inside the row above when the depth is one more than its own. At the row
 * below's depth, before that row, in its own slot and at its own index: the
 * rows of a container's slots are drawn as one run, so the row above can sit
 * in a different slot from the row below, and "after the row above" would put
 * the block in the wrong one. Otherwise after the row above's ancestor at that
 * depth.
 */
function positionFor(
  document: BlockDocument,
  components: PlacementSources["components"],
  gap: Gap,
  depth: number
): OpPosition | undefined {
  const { above, below } = gap;
  if (above === undefined) return { index: 0 };
  if (depth > above.depth) {
    return positionInside(document.nodes, components, above, below);
  }
  if (below !== undefined && below.depth === depth) return positionOf(below);
  // The trail from the top of the page down to the row above, so its entry at
  // `depth` is the block the drop goes after. Read from the document rather
  // than from the rows: an ancestor may be scrolled out of the drawn window.
  const anchor = pathTo(document, above.id)[depth];
  return anchor === undefined
    ? undefined
    : positionAfter(document.nodes, anchor.id);
}

/**
 * The position inside the row above: before the row below when that row is
 * the first thing it shows, at the end of the slot an indent enters otherwise.
 * A container that cannot name one slot for an indent is aimed at the default
 * slot, which the placement rule then refuses in its own words.
 */
function positionInside(
  nodes: BlockNode[],
  components: PlacementSources["components"],
  above: LayersRow,
  below: LayersRow | undefined
): OpPosition | undefined {
  if (below?.parentId === above.id && below.slot !== undefined) {
    return { parentId: above.id, slot: below.slot, index: below.index };
  }
  const container = findNode(nodes, above.id);
  if (container === undefined) return undefined;
  const slot = indentSlot(container, components) ?? DEFAULT_SLOT;
  return {
    parentId: above.id,
    slot,
    index: container.slots?.[slot]?.length ?? 0,
  };
}

/**
 * The position with the dragged block lifted out first, which is what the
 * store's `move` addresses; `undefined` when that is where it already is.
 */
function liftedPosition(
  nodes: BlockNode[],
  draggedId: string,
  to: OpPosition
): OpPosition | undefined {
  const here = locateNode(nodes, draggedId);
  if (here === undefined) return undefined;
  const sameList =
    here.parent?.id === to.parentId &&
    (to.parentId === undefined || here.slot === to.slot);
  if (!sameList) return to;
  const index = here.index < to.index ? to.index - 1 : to.index;
  if (index === here.index) return undefined;
  return { ...to, index };
}

/** The slot a move would leave, when the block leaves the list it is in. */
function vacated(
  nodes: BlockNode[],
  draggedId: string,
  to: OpPosition
): SlotAddress | undefined {
  const here = locateNode(nodes, draggedId);
  if (here?.parent === undefined || here.slot === undefined) return undefined;
  if (here.parent.id === to.parentId && here.slot === to.slot) return undefined;
  return { parentId: here.parent.id, slot: here.slot };
}

/** The placement rule's refusal of the block at `to`, or `undefined`. */
function placementRefusal(
  placement: LayersPlacement,
  moving: BlockNode,
  to: OpPosition
): LayersRefusal | undefined {
  const { document, sources, verdicts } = placement;
  const verdict = heldIn(
    verdicts.placement,
    to.parentId ?? null,
    to.slot ?? "",
    () =>
      canPlaceIn(
        document.nodes,
        [moving],
        to.parentId === undefined
          ? { kind: "root" }
          : { kind: "slot", parentId: to.parentId, slot: to.slot },
        sources
      )
  );
  if (verdict.allowed) return undefined;
  const parent =
    to.parentId === undefined
      ? undefined
      : findNode(document.nodes, to.parentId);
  return {
    kind: "placement",
    verdict,
    movingType: moving.type,
    regionType: parent?.type,
  };
}

/** The lock a move to `to` would break, as a refusal, or `undefined`. */
function lockRefusalAt(
  placement: LayersPlacement,
  op: Extract<BuilderOp, { kind: "move" }>
): LayersRefusal | undefined {
  const { to } = op;
  const slots = heldIn(
    placement.verdicts.locks,
    to.parentId ?? null,
    to.slot ?? "",
    () => new Map<number, LockRefusalFacts | null>()
  );
  let lock = slots.get(to.index);
  if (lock === undefined) {
    lock = placement.lockRefusalFor([op]) ?? null;
    slots.set(to.index, lock);
  }
  return lock === null ? undefined : { kind: "lock", lock };
}

/**
 * The gap at the pointer's height, or `undefined` outside every row.
 *
 * The upper half of a row is the gap before it, the lower half the gap after.
 * The dragged block and everything inside it are not places it can go, so the
 * gap is between the nearest rows outside it.
 */
function gapAt(
  rows: readonly LayersRow[],
  y: number,
  moving: ReadonlySet<string>
): Gap | undefined {
  const over = rowAt(rows, y);
  if (over === undefined) return undefined;
  const at = rows.indexOf(over);
  const before = y < over.top + over.height / 2;
  const above = nearestOutside(rows, before ? at - 1 : at, -1, moving);
  const below = nearestOutside(rows, before ? at : at + 1, 1, moving);
  if (above === undefined && below === undefined) return undefined;
  return { above, below, y: before ? over.top : over.top + over.height };
}

/**
 * The depth the pointer's x asks for, clamped to what the gap allows: no
 * shallower than the row below, no deeper than one past a row above that holds
 * blocks. The floor wins when the two cross, so the row below always keeps a
 * parent.
 */
function depthAt(gap: Gap, x: number, left: number): number {
  const { above, below } = gap;
  const deepest =
    above === undefined ? 0 : above.depth + (above.canHoldChildren ? 1 : 0);
  const wanted = Math.round((x - left) / LAYERS_DEPTH_PX);
  return Math.max(below?.depth ?? 0, Math.min(wanted, deepest));
}

/**
 * Whether a gap and a depth name the place the dragged block already holds:
 * its own row lies between the rows either side of the gap, and the depth is
 * its own.
 */
function isOwnPlace(
  rows: readonly LayersRow[],
  gap: Gap,
  draggedId: string,
  depth: number
): boolean {
  const own = rows.findIndex(row => row.id === draggedId);
  if (own === -1 || rows[own]?.depth !== depth) return false;
  const above = gap.above === undefined ? -1 : rows.indexOf(gap.above);
  const below = gap.below === undefined ? rows.length : rows.indexOf(gap.below);
  return above < own && own < below;
}

/** The move to `to`, judged by the placement rule and then the locks. */
function judged(
  placement: LayersPlacement,
  moving: BlockNode,
  to: OpPosition,
  line: LayersLine
): LayersDropResult {
  // The editor's own question first (`lockBlockingMove`): a locked block,
  // one inside the dragged block or one it sits inside holds it wherever it
  // would go, so every place answers the same way.
  const held = lockBlockingMove(placement.document, moving.id);
  if (held !== undefined) {
    return {
      kind: "refused",
      refusal: { kind: "held", locked: held, movingId: moving.id },
      line,
    };
  }
  const refused = placementRefusal(placement, moving, to);
  if (refused !== undefined) return { kind: "refused", refusal: refused, line };
  const dropSlotIfEmpty = vacated(placement.document.nodes, moving.id, to);
  const leaves = dropSlotIfEmpty === undefined ? {} : { dropSlotIfEmpty };
  const locked = lockRefusalAt(placement, {
    kind: "move",
    id: moving.id,
    to,
    ...leaves,
  });
  if (locked !== undefined) return { kind: "refused", refusal: locked, line };
  return { kind: "drop", to, ...leaves, line };
}

/**
 * Where a dragged row would land, and whether it may.
 *
 * `none` outside every row, and at the place the block already occupies —
 * a drop there would be an edit that changes nothing, and an undo step the
 * author never made.
 */
export function layersDrop(input: LayersDropInput): LayersDropResult {
  const { rows, draggedId, pointer, placement } = input;
  const { document } = placement;
  const moving = findNode(document.nodes, draggedId);
  if (moving === undefined) return NONE;
  const gap = gapAt(rows, pointer.y, movingSubtree(document, draggedId));
  if (gap === undefined) return NONE;

  const depth = depthAt(gap, pointer.x, input.left);
  // The gap the block was lifted from, at the depth it had, is where it
  // already is. Asked of its own row rather than of the rows either side:
  // those can sit in two different slots of one container, and either one
  // would move the block into the wrong slot.
  if (isOwnPlace(rows, gap, draggedId, depth)) return NONE;
  const aimed = positionFor(document, placement.sources.components, gap, depth);
  const to =
    aimed === undefined
      ? undefined
      : liftedPosition(document.nodes, draggedId, aimed);
  if (to === undefined) return NONE;
  return judged(placement, moving, to, { y: gap.y, depth });
}
