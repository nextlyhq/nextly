/**
 * Where the canvas's gap "+" controls go: in each gap between two top-level
 * blocks, after the last top-level block, and between the children of the
 * selected block, in the direction they are laid out.
 *
 * Pure measurement and arithmetic, kept apart from the component that draws
 * the controls: which gaps exist, where each one's middle is in the chrome's
 * coordinates, which one the pointer is near, and the order a keyboard meets
 * them in.
 *
 * ## The direction is the layout's
 *
 * A Section can lay its children out in a column, a row, or a wrapping grid.
 * The gap between two children is read from where the browser drew them: one
 * beside the other is a gap down the row (a vertical line), one below the
 * other is a gap across the column (a horizontal line). Reading the drawn
 * boxes rather than the container's `flex-direction` alone covers a row that
 * wraps, a reversed row and a grid, each of which the computed layout has
 * already resolved into boxes.
 *
 * @module page-gaps
 */

import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";

import type { Rect } from "../geometry";

import { outermostElementsOf } from "./canvas-addressing";
import {
  canvasContentRect,
  drawnBoxes,
  type OverlaySpace,
} from "./geometry-dom";
import { unionRect } from "./toolbar-actions";

/**
 * Which way a gap's line runs: `across` a column of blocks (one above the
 * other), or `down` a row of them (one beside the other).
 */
export type GapLine = "across" | "down";

/** One gap a "+" is drawn in. */
export interface Gap {
  /** The block before the gap, which a new block goes after. */
  readonly after: string;
  /** The block after it, or `undefined` for the gap after the last block. */
  readonly before: string | undefined;
  /** Which way the gap's line runs. */
  readonly line: GapLine;
  /** The gap's middle, in the chrome's coordinates. */
  readonly x: number;
  readonly y: number;
  /** How long the line along the gap is drawn. */
  readonly length: number;
  /**
   * How near the pointer must be to the line for the "+" to show: never more
   * than a quarter of the shorter block beside it, so the middle of a block
   * is never near a gap however short the block is drawn.
   */
  readonly reach: number;
  /**
   * Whether a "+" centred on the line leaves the middle of both blocks beside
   * it uncovered: each is at least as deep as the "+" is.
   */
  readonly roomy: boolean;
}

/**
 * How near the pointer must be to a gap for its "+" to show, in the chrome's
 * pixels: less than half a short block's height, so the middle of a block
 * one line tall stays the block's to press.
 */
const NEAR_GAP_PX = 8;

/** The "+"'s side on screen, in the chrome's pixels: the 24px target floor. */
export const GAP_CONTROL_PX = 24;

/**
 * How deep the blocks beside a gap are, across its line: their heights
 * beside a line across, their widths beside a line down.
 */
function depthBeside(line: GapLine, rects: readonly Rect[]): number {
  return Math.min(
    ...rects.map(rect => (line === "across" ? rect.height : rect.width))
  );
}

/** The reach and room of a gap between blocks this deep. */
function clearance(depth: number): Pick<Gap, "reach" | "roomy"> {
  return {
    reach: Math.min(NEAR_GAP_PX, depth / 4),
    roomy: depth >= GAP_CONTROL_PX,
  };
}

/** A drawn block: its id and the union of the boxes it is drawn as. */
interface Drawn {
  readonly id: string;
  readonly rect: Rect;
}

/**
 * Each of `ids` that is drawn, in the order given, measured as the union of
 * every element drawn for it that generates a box.
 *
 * A component placement draws one element per top-level node of its
 * definition, so its first element alone would end it early and put the next
 * gap's "+" inside it; a block hidden on this device (`display: none`)
 * generates no box, and a gap measured from its empty rectangle would add a
 * "+" beside a block nobody can see. Outermost only, as the drag measures a
 * block, so an element nested inside the same placement is not counted twice.
 */
function drawnOf(space: OverlaySpace, ids: readonly string[]): Drawn[] {
  const { root } = space;
  const parts = new Map<string, Rect[]>();
  for (const [id, elements] of outermostElementsOf(root, new Set(ids))) {
    parts.set(
      id,
      elements
        .flatMap(drawnBoxes)
        .map(drawn => space.place(canvasContentRect(drawn, root)))
    );
  }
  return ids.flatMap(id => {
    const rect = unionRect(parts.get(id) ?? []);
    return rect === undefined ? [] : [{ id, rect }];
  });
}

/**
 * Where the line between two boxes drawn beside each other runs, or
 * `undefined` where one is not beside the other. Either order, so a reversed
 * row reads as a row.
 */
function edgeBetween(a: Rect, b: Rect): number | undefined {
  const shareHeight = a.y < b.y + b.height && b.y < a.y + a.height;
  if (!shareHeight) return undefined;
  if (b.x >= a.x + a.width) return (a.x + a.width + b.x) / 2;
  if (b.x + b.width <= a.x) return (b.x + b.width + a.x) / 2;
  return undefined;
}

/**
 * The gap between two blocks drawn one after the other, from their boxes:
 * down the line between them where one is beside the other, across it where
 * one is below the other. `span`, when given, is what a line across runs the
 * width of: the page, for its top-level blocks.
 */
function gapBetween(above: Drawn, below: Drawn, span?: Rect): Gap {
  const a = above.rect;
  const b = below.rect;
  const edge = edgeBetween(a, b);
  if (edge !== undefined) {
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return {
      after: above.id,
      before: below.id,
      line: "down",
      x: edge,
      y: (top + bottom) / 2,
      length: bottom - top,
      ...clearance(depthBeside("down", [a, b])),
    };
  }
  const run = span ?? unionRect([a, b]) ?? a;
  return {
    after: above.id,
    before: below.id,
    line: "across",
    x: run.x + run.width / 2,
    y: (a.y + a.height + b.y) / 2,
    length: run.width,
    ...clearance(depthBeside("across", [a, b])),
  };
}

/** The gaps between consecutive drawn blocks. */
function gapsAlong(drawn: readonly Drawn[], span?: Rect): Gap[] {
  return drawn.slice(1).map((below, index) => {
    // `index` is the block before `below`, as the slice starts one in.
    const above = drawn[index];
    return gapBetween(above, below, span);
  });
}

/**
 * The gaps between the selected block's children, in each region it holds
 * blocks in: none when nothing is selected, or the selection holds fewer than
 * two drawn blocks in every region.
 */
function childGaps(
  space: OverlaySpace,
  document: BlockDocument,
  selectedId: string | null
): Gap[] {
  if (selectedId === null) return [];
  const node = findNode(document.nodes, selectedId);
  return Object.values(node?.slots ?? {}).flatMap(children =>
    gapsAlong(
      drawnOf(
        space,
        children.map(child => child.id)
      )
    )
  );
}

/**
 * Every gap a "+" is drawn in, in the order a reader meets them: from the top
 * of the page down, then from the left.
 *
 * @param space - the chrome the controls are drawn in, over the canvas root
 * @param document - the page, whose top-level blocks the first gaps are between
 * @param selectedId - the selected block, whose children get gaps of their own
 */
export function measureGaps(
  space: OverlaySpace,
  document: BlockDocument,
  selectedId: string | null
): readonly Gap[] {
  const { root } = space;
  const page = space.place(canvasContentRect(root, root));
  const top = drawnOf(
    space,
    document.nodes.map(node => node.id)
  );
  const last = top.at(-1);
  // After the last top-level block, on its bottom edge: where the page's own
  // blocks end, above a Layout's footer.
  const end: Gap[] =
    last === undefined
      ? []
      : [
          {
            after: last.id,
            before: undefined,
            line: "across",
            x: page.x + page.width / 2,
            y: last.rect.y + last.rect.height,
            length: page.width,
            ...clearance(last.rect.height),
          },
        ];
  return [
    ...gapsAlong(top, page),
    ...end,
    ...childGaps(space, document, selectedId),
  ].sort(readingOrder);
}

/** From the top of the page down, then from the left. */
function readingOrder(a: Gap, b: Gap): number {
  return a.y - b.y || a.x - b.x;
}

/**
 * How far a point is from a gap's line, or `undefined` where it is past the
 * line's ends: beside a row's gap, not above or below the row.
 */
export function distanceTo(gap: Gap, x: number, y: number): number | undefined {
  const [across, along] =
    gap.line === "across" ? [y - gap.y, x - gap.x] : [x - gap.x, y - gap.y];
  if (Math.abs(along) > gap.length / 2) return undefined;
  return Math.abs(across);
}

/**
 * The gap the pointer is within reach of, by its key: the nearest, where it
 * is near two (a child's gap close to the page's).
 */
export function gapNear(
  gaps: readonly Gap[],
  x: number,
  y: number
): string | undefined {
  let nearest: { key: string; distance: number } | undefined;
  for (const gap of gaps) {
    const distance = distanceTo(gap, x, y);
    if (distance === undefined || distance > gap.reach) continue;
    if (nearest === undefined || distance < nearest.distance) {
      nearest = { key: gapKey(gap), distance };
    }
  }
  return nearest?.key;
}

/** A gap's identity: the two blocks it is between. */
export function gapKey(gap: Gap): string {
  // Encoded rather than joined: an id can hold any character, so a separator
  // could make two different pairs read the same.
  return JSON.stringify([gap.after, gap.before ?? null]);
}

/**
 * The first gap a reader meets below the top of `block`: the "+" Tab moves
 * to from that block. The one below it, or, for a selected block holding a
 * row, the first between its own children.
 */
export function gapAfter(gaps: readonly Gap[], block: Rect): Gap | undefined {
  return gaps.find(gap => gap.y > block.y);
}

/**
 * The box a block is drawn as, in the chrome's coordinates, or `undefined`
 * where it is not drawn: measured as a gap's blocks are.
 */
export function blockRectOf(space: OverlaySpace, id: string): Rect | undefined {
  return drawnOf(space, [id])[0]?.rect;
}
