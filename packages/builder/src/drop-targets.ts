/**
 * Where a dragged block can land, and which of those places the pointer means.
 *
 * The canvas has to answer one question on every pointer move: of all the
 * positions a block could be dropped into, which one is the author aiming at?
 * This module answers it, and the shape of the answer is the whole design.
 *
 * ## Regions first, then lines — and that order is the point
 *
 * Three earlier designs for this failed, and they failed for one reason. Each
 * tried to SCORE every candidate position against the pointer and take the best
 * score. Scoring is comparative, so the moment two positions in different
 * containers can tie, their scores have to mean the same thing — and no measure
 * of a single position can encode "the pointer is inside THIS container and not
 * that one", because containment is a statement about the candidates you are
 * being compared against.
 *
 * The way out is to stop comparing across containers at all:
 *
 * 1. **Resolve the region.** The deepest container whose rectangle holds the
 *    pointer owns the drop. This is decided, not scored.
 * 2. **Rank inside it.** Only then, and only among that region's own insertion
 *    points, measure a distance.
 *
 * Every number in a comparison is then the same kind of number by construction,
 * and "which container" is never something a distance has to smuggle.
 *
 * ## An insertion point is a LINE, not a rectangle
 *
 * The natural thing to measure against is the middle of a drop zone. It is also
 * wrong, and wrong in a way that only shows up when adjacent blocks have
 * different heights: a short block's midpoint sits close to its neighbour's, so
 * the target flips while the pointer is still well inside the block the author
 * is pointing at, and the block lands at the wrong index.
 *
 * An insertion point is a place children are separated, so it is a LINE. Ranking
 * by distance to that line puts the switch boundary exactly at each child's
 * centre, whatever the children's sizes are — which is the behaviour an author
 * expects and describes as "it goes where I point".
 *
 * ## Nothing here reads a block's height as a threshold
 *
 * A rule of the form "a block must be at least N pixels tall to compete" cannot
 * work on this canvas. `core/spacer` takes its height from an author-set prop
 * with no lower bound, and `core/divider` renders as a one-pixel rule — so any
 * N excludes some block an author can legitimately place, and excluding it
 * means they can never drop beside it. There is no floor to measure, so this
 * module measures distances and never a size.
 *
 * Steadiness near a boundary is not this module's job either. It reports the
 * target the pointer is over right now; {@link nextTargetSwitchState} decides
 * when a new one is allowed to replace the committed one, on pointer travel
 * rather than on geometry. Keeping the two apart is what lets a region boundary
 * be an ordinary candidate change rather than a special case: hysteresis is
 * applied to the resolved answer, so it does not matter which region produced
 * it.
 *
 * Pure, and it takes measured rectangles rather than elements — so every rule
 * above is assertable without a browser, which matters because jsdom reports
 * every element as zero-sized and could not exercise one of them.
 *
 * @module drop-targets
 */

import type {
  BlockDocument,
  BlockNode,
  NestingRefusal,
  NestingSource,
} from "@nextlyhq/blocks-engine";

import type { Point, Rect } from "./geometry";
import { blockAllowedAt, type InsertTarget, type SlotSource } from "./inserter";
import type { OpPosition } from "./ops";

/**
 * The direction a region lays its children out.
 *
 * `"y"` is an ordinary vertical stack; `"x"` is a row or a grid track running
 * across. It decides which coordinate separates two children and therefore
 * which way an insertion line is drawn.
 */
export type DropAxis = "x" | "y";

/** The region id standing for the document's top level. */
export const ROOT_REGION = "root";

/**
 * Rectangles, measured from wherever they actually are.
 *
 * An interface rather than a DOM read so this module stays pure. The canvas
 * supplies one backed by `getBoundingClientRect`; a test supplies a literal.
 *
 * All rectangles must be in ONE coordinate space — the canvas's. Mixing spaces
 * produces an indicator drawn a constant distance from the gap it names, which
 * looks like a styling mistake rather than a measurement one.
 */
export interface RectSource {
  /** Where a node's element sits, or `undefined` when it rendered nothing. */
  rectOf(nodeId: string): Rect | undefined;
  /** The canvas's own extent, which is the root region's. */
  rootRect(): Rect;
}

/**
 * One container's child list, as somewhere a block can be dropped.
 *
 * A region is addressed by a parent and a slot, never by position: the document
 * makes ids the only thing anything stores, and a positional region would name
 * a different container the moment a sibling is inserted above it.
 */
export interface DropRegion {
  /** Stable identity: {@link ROOT_REGION}, or `"<parentId>::<slot>"`. */
  readonly id: string;
  /** What this region is, as the nesting rule needs to see it. */
  readonly at: InsertTarget;
  /** The container node, absent for the root region. */
  readonly parentId?: string;
  /** The slot within that container, absent for the root region. */
  readonly slot?: string;
  /** How far inside the document this region sits; the root is 0. */
  readonly depth: number;
  /** The container's measured extent, which decides what it contains. */
  readonly rect: Rect;
  /** Which way its children run. */
  readonly axis: DropAxis;
  /** Its children's ids, in document order. */
  readonly childIds: readonly string[];
}

/**
 * One place a block can land, and the line that says so.
 *
 * `at` is what the op needs and `line` is what the author sees, produced
 * together for the same reason the inserter produces a position and its target
 * together: computed apart, the indicator and the drop can be derived from
 * different readings and the block lands somewhere other than where the line
 * was drawn.
 */
export interface DropTarget {
  /**
   * Stable identity across pointer moves.
   *
   * Required by the switch rule, which compares the committed target with a
   * rival — an identity derived from the rectangle would differ every time the
   * page reflowed, and every reflow would read as a crossing.
   */
  readonly id: string;
  /** The region this target belongs to. */
  readonly regionId: string;
  /** Where the block goes. */
  readonly at: OpPosition;
  /** What that position is, for the nesting rule. */
  readonly target: InsertTarget;
  /** The axis children are separated along. */
  readonly axis: DropAxis;
  /**
   * Where the line sits along {@link axis} — a `y` for a horizontal line, an
   * `x` for a vertical one.
   */
  readonly line: number;
  /** Where the line starts, across the axis. */
  readonly from: number;
  /** Where the line ends, across the axis. */
  readonly to: number;
}

/**
 * Why a drop the author aimed at cannot happen.
 *
 * The engine's refusal CODE, not a sentence. Wording is a presentation
 * decision — it belongs where the words are drawn and where they can be
 * translated — and a code is what a caller can branch on. `permitted` travels
 * with it because naming what the region DOES take is the difference between
 * "no" and an instruction.
 */
export interface DropRefusal {
  readonly regionId: string;
  /**
   * The container node the refusing region belongs to, absent at the root.
   *
   * Carried for the same reason `permitted` is: a surface explaining the
   * refusal needs it, and this is the only place it is still known. A region is
   * identified by `"<parentId>::<slot>"`, so recovering the node from
   * {@link DropRefusal.regionId} means splitting a composite string — reading a
   * value back out of a spelling this module chose, which stops being correct
   * the moment the spelling does.
   *
   * Absent rather than a sentinel at the root, because "there is no container"
   * is the fact that separates a refusal an author can fix by aiming elsewhere
   * from one that needs a container to exist first.
   */
  readonly parentId?: string;
  readonly reason: NestingRefusal;
  readonly permitted: readonly string[];
}

/**
 * What the pointer currently means.
 *
 * A refusal is a distinct answer rather than an absent target, and the
 * distinction is what the canvas needs to say why. An author who drags a
 * heading over an accordion has aimed at something; showing no indicator tells
 * them the editor did not notice, while showing a refusal tells them the region
 * does not take that block.
 */
export type DropResolution =
  | { readonly kind: "target"; readonly target: DropTarget }
  | { readonly kind: "refused"; readonly refusal: DropRefusal }
  | { readonly kind: "none" };

/** The coordinate that separates children on an axis. */
function along(point: Point, axis: DropAxis): number {
  return axis === "y" ? point.y : point.x;
}

/** A rectangle's leading edge on an axis. */
function leadingEdge(rect: Rect, axis: DropAxis): number {
  return axis === "y" ? rect.y : rect.x;
}

/** A rectangle's trailing edge on an axis. */
function trailingEdge(rect: Rect, axis: DropAxis): number {
  return axis === "y" ? rect.y + rect.height : rect.x + rect.width;
}

/** Whether a rectangle holds a point, edges included. */
function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Which way a region's children run, read from where they actually landed.
 *
 * Measured rather than declared. A container's CSS is only half the story — a
 * `flex-direction: row` whose children wrapped runs down the page, and a block
 * that declares nothing still lays out somehow — so the rectangles are the
 * evidence and the declaration is a claim about them. Reading the result also
 * means grid, flex, inline and ordinary flow need no separate handling.
 *
 * The axis with the greater spread of leading edges wins. Children stacked
 * vertically share an `x` and differ in `y`, and a row is the reverse.
 *
 * **Vertical when there is no evidence** — fewer than two children, or children
 * that spread equally. A single child cannot indicate a direction, and page
 * content runs down the page far more often than across.
 *
 * **Known limit: a region that WRAPS is served on one axis only.** A grid of
 * three columns by two rows genuinely separates its children both ways, and a
 * single line cannot express "after the end of row one". Such a region gets its
 * dominant axis, which orders row-major grids correctly and leaves column-major
 * ones approximate.
 */
export function axisOfRects(rects: readonly Rect[]): DropAxis {
  if (rects.length < 2) return "y";
  const xs = rects.map(rect => rect.x);
  const ys = rects.map(rect => rect.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  return spreadX > spreadY ? "x" : "y";
}

/**
 * Every region in the document, deepest last.
 *
 * A container contributes a region for each slot its DEFINITION declares, not
 * for each slot its node happens to hold. An empty container carries no `slots`
 * key at all — `makeNode` writes one only when children are supplied — so
 * asking the node would produce no region for exactly the containers that most
 * need one, and an author could never fill anything they had just inserted.
 *
 * A container that rendered nothing measurable is skipped rather than given a
 * zero rectangle. A zero rectangle contains no point, so it would never be
 * resolved, but it WOULD sit in the list claiming to be droppable — an absence
 * that reads as a presence is the harder of the two to notice.
 */
export function collectRegions(
  document: BlockDocument,
  slots: SlotSource,
  rects: RectSource
): DropRegion[] {
  const regions: DropRegion[] = [];

  const walk = (nodes: readonly BlockNode[], depth: number): void => {
    for (const node of nodes) {
      const declared = slots.slotsOf(node.type) ?? [];
      for (const slot of declared) {
        const rect = rects.rectOf(node.id);
        if (rect === undefined) continue;
        const children = node.slots?.[slot] ?? [];
        const childRects = children
          .map(child => rects.rectOf(child.id))
          .filter((child): child is Rect => child !== undefined);
        regions.push({
          id: `${node.id}::${slot}`,
          at: { at: "slot", parentType: node.type, slot },
          parentId: node.id,
          slot,
          depth,
          rect,
          axis: axisOfRects(childRects),
          childIds: children.map(child => child.id),
        });
        walk(children, depth + 1);
      }
    }
  };

  const rootChildRects = document.nodes
    .map(node => rects.rectOf(node.id))
    .filter((rect): rect is Rect => rect !== undefined);

  regions.push({
    id: ROOT_REGION,
    at: { at: "root" },
    depth: 0,
    rect: rects.rootRect(),
    axis: axisOfRects(rootChildRects),
    childIds: document.nodes.map(node => node.id),
  });

  walk(document.nodes, 1);
  return regions;
}

/**
 * The insertion lines inside one region, in index order.
 *
 * A region with `n` children has `n + 1` of them. The first sits on the first
 * child's leading edge and the last on the final child's trailing edge; the
 * ones between sit in the middle of the gap separating two children, which is
 * where an author sees the boundary and where a margin puts it.
 *
 * Ranking by distance to these lines is what makes each child's CENTRE the
 * place the target changes: a pointer in a child's leading half is nearer the
 * line before it, and in its trailing half nearer the line after. That holds
 * for children of any size, which is precisely what a rule measuring to a zone's
 * middle gets wrong.
 *
 * **An empty region still has one**, drawn across its middle. It is the only
 * way to fill a container that has just been inserted, and a container that
 * cannot be filled is decorative.
 *
 * A child that rendered nothing measurable is skipped, but its INDEX is not:
 * the op addresses a position in the stored children, and quietly renumbering
 * around an unrendered node would drop the block at a different index from the
 * one the line was drawn for.
 */
export function targetsInRegion(
  region: DropRegion,
  rects: RectSource
): DropTarget[] {
  const axis = region.axis;
  const across: Pick<DropTarget, "from" | "to"> =
    axis === "y"
      ? { from: region.rect.x, to: region.rect.x + region.rect.width }
      : { from: region.rect.y, to: region.rect.y + region.rect.height };

  const positionAt = (index: number): OpPosition =>
    region.parentId === undefined || region.slot === undefined
      ? { index }
      : { parentId: region.parentId, slot: region.slot, index };

  const make = (index: number, line: number): DropTarget => ({
    id: `${region.id}#${String(index)}`,
    regionId: region.id,
    at: positionAt(index),
    target: region.at,
    axis,
    line,
    ...across,
  });

  const measured = region.childIds.map(id => rects.rectOf(id));
  const rendered = measured.filter((rect): rect is Rect => rect !== undefined);
  if (rendered.length === 0) {
    // Across the middle: with nothing rendered there is no gap to sit in, and
    // an edge would read as "beside this container" rather than "inside it".
    const middle =
      axis === "y"
        ? region.rect.y + region.rect.height / 2
        : region.rect.x + region.rect.width / 2;
    return [make(0, middle)];
  }

  const targets: DropTarget[] = [];
  let previous: Rect | undefined;
  measured.forEach((rect, index) => {
    if (rect === undefined) return;
    targets.push(
      make(
        index,
        previous === undefined
          ? leadingEdge(rect, axis)
          : // The middle of the gap. Reading either edge alone puts the line
            // against one of the two blocks, so a margin makes it look like it
            // belongs to that one rather than to the space between them.
            (trailingEdge(previous, axis) + leadingEdge(rect, axis)) / 2
      )
    );
    previous = rect;
  });
  if (previous !== undefined) {
    targets.push(make(region.childIds.length, trailingEdge(previous, axis)));
  }
  return targets;
}

/** Ids of a node and everything under it. */
function subtreeIds(node: BlockNode, into: Set<string>): void {
  into.add(node.id);
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) subtreeIds(child, into);
  }
}

/**
 * The node with this id, and everything inside it.
 *
 * A block cannot be dropped into itself or into anything it contains: the move
 * would detach a subtree and re-attach it beneath itself, which is not a page.
 * Collected as a set so the check below is a lookup rather than a walk per
 * candidate region.
 */
export function movingSubtree(
  document: BlockDocument,
  movingId: string | undefined
): Set<string> {
  const ids = new Set<string>();
  if (movingId === undefined) return ids;
  const find = (nodes: readonly BlockNode[]): BlockNode | undefined => {
    for (const node of nodes) {
      if (node.id === movingId) return node;
      for (const children of Object.values(node.slots ?? {})) {
        const found = find(children);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  const node = find(document.nodes);
  if (node !== undefined) subtreeIds(node, ids);
  return ids;
}

/** What {@link resolveDrop} needs to answer a pointer. */
export interface DropQuery {
  /** The block being dragged, as its registered type name. */
  readonly blockName: string;
  /**
   * Nodes the drop may not land inside: the dragged block and its descendants.
   *
   * Empty for a drag from the palette, where nothing is being detached. Passed
   * in already computed rather than derived here, because it cannot change
   * during a drag while this runs on every pointer move — and a walk of the
   * document per move is work whose answer is known before the drag starts.
   *
   * Build it with {@link movingSubtree}.
   */
  readonly forbiddenParents: ReadonlySet<string>;
  readonly regions: readonly DropRegion[];
  readonly nesting: NestingSource;
  readonly rects: RectSource;
}

/**
 * Which region owns the pointer.
 *
 * The DEEPEST containing one, so a container nested inside another claims the
 * pointer over its own area rather than losing it to the ancestor it sits in.
 * Ties on depth go to the one declared later, which is document order — a
 * region overlapping a sibling is already a layout the author can see, and
 * taking the later one matches which of the two paints on top.
 *
 * `undefined` when the pointer is outside everything, INCLUDING outside the
 * root. Falling back to the root would let a drop resolve from a pointer that
 * had left the canvas, which is how a block lands on the page after a drag the
 * author abandoned by dragging away.
 */
export function regionAt(
  regions: readonly DropRegion[],
  pointer: Point,
  forbiddenParents: ReadonlySet<string> = new Set()
): DropRegion | undefined {
  let owner: DropRegion | undefined;
  for (const region of regions) {
    // A region inside the block being dragged is SKIPPED rather than refused,
    // so the pointer falls through to the container around it. That is what an
    // author dragging a box over its own interior means: put it beside itself.
    // Refusing here would show "you cannot drop that there" for a gesture with
    // an obvious correct reading.
    if (
      region.parentId !== undefined &&
      forbiddenParents.has(region.parentId)
    ) {
      continue;
    }
    if (!contains(region.rect, pointer)) continue;
    if (owner === undefined || region.depth >= owner.depth) owner = region;
  }
  return owner;
}

/**
 * The target the pointer means right now.
 *
 * Region first, then the nearest line inside it — never a distance across the
 * two, for the reason in the module docblock.
 *
 * A region the block cannot go in produces a REFUSAL rather than deferring to
 * the container around it. Resolving to the ancestor would silently drop the
 * block somewhere the author was not aiming, which the nesting rule exists to
 * prevent; saying no is the honest answer and it carries the reason.
 */
export function resolveDrop(query: DropQuery, pointer: Point): DropResolution {
  const region = regionAt(query.regions, pointer, query.forbiddenParents);
  if (region === undefined) return { kind: "none" };

  const verdict = blockAllowedAt(query.blockName, region.at, query.nesting);
  if (!verdict.allowed) {
    return {
      kind: "refused",
      refusal: {
        regionId: region.id,
        // Taken from the region rather than parsed back out of its id: the
        // region is the richer value and it is already in hand here.
        //
        // SPREAD rather than assigned, so the root case has no `parentId` key
        // at all. Writing `parentId: undefined` creates an own property whose
        // value is undefined, which reads the same through `?.` and differently
        // through `in`, `Object.keys` and a strict comparison — and the type
        // documents the field as absent at the root rather than as present and
        // empty. A shape that only matches its documentation under the loosest
        // reading is one nobody can rely on.
        ...(region.parentId === undefined ? {} : { parentId: region.parentId }),
        reason: verdict.reason,
        permitted: verdict.permitted,
      },
    };
  }

  let best: DropTarget | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of targetsInRegion(region, query.rects)) {
    const distance = Math.abs(along(pointer, candidate.axis) - candidate.line);
    // Strictly nearer, so an exact tie keeps the EARLIER index. Two lines
    // coincide when a child measures zero on the axis, and preferring the later
    // one there would make a drop land after a block the author aimed before.
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  // Undefined for a region with no lines at all, and for one whose coordinates
  // are not comparable. Starting from an infinite distance rather than from the
  // first element is what makes those the same answer: seeding with `targets[0]`
  // would commit to a line before measuring it, so a region producing only
  // unusable coordinates would resolve to one of them.
  if (best === undefined) return { kind: "none" };
  return { kind: "target", target: best };
}
