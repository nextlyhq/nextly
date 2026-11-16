"use client";

/**
 * Where the tabs drawn on blocks' outlines go, so that no two cover each
 * other, whichever layer of the editor's chrome draws them.
 *
 * Three layers draw over a block's top edge: the marks' at-rest tabs
 * ("Conditional", an Entry content block's words) in `canvas-marks.tsx`, the
 * "Visitors won't see this" badge in `visitor-unreadable-badges.tsx`, and the
 * block toolbar over the selection in `block-toolbar.tsx`. Each is a layer of
 * its own (the marks are hidden from assistive technology, the badge and the
 * toolbar are controls a keyboard reaches), so none can place what another
 * draws. Placed apart, layer by layer, each would keep clear of its own and
 * sit on the others: a block both conditional and read by a field visitors
 * can't read had its two tabs on one corner, and the toolbar over a selected
 * block covered its badge.
 *
 * So the layers share one board per canvas root. Each posts what it draws
 * there, the tabs it would place (`TabDraft`) and the boxes it has already
 * placed and keeps (the toolbar's), and every layer places its tabs by ONE
 * pass over everything posted (`tabsApart`). The pass is a pure function of
 * what is posted, so every layer reading the same board gets the same
 * answer, and its own part of it; a post that changes the board tells the
 * other layers, which place their tabs again from what they last measured.
 *
 * @module canvas-tab-places
 */

import * as React from "react";

import type { Rect } from "./geometry";

/** Where a tab stands on its outline: on the top edge, the bottom, or inside the top. */
export type TabAt = "above" | "below" | "inside";

/**
 * One tab to place: the block it marks, the outline whose edge it stands on,
 * where it may go in order of preference, and how big it is.
 */
export interface TabDraft {
  /**
   * The block's own box, which orders the pass: an at-rest outline and a
   * visitor badge's outline around the same block start at its box.
   */
  readonly block: Rect;
  /** The outline the tab stands on, in the chrome's coordinates. */
  readonly edge: Rect;
  /** Where it may go, in order of preference; the first is where it goes alone. */
  readonly places: readonly TabAt[];
  /** How far in from the outline's right edge it is drawn alone. */
  readonly side: number;
  /** About how wide it is drawn, no wider than the stylesheet lets it run. */
  readonly width: number;
  /** How tall it is drawn. */
  readonly height: number;
  /**
   * How much of its height it shares with the outline's dash, where its foot
   * sits on it: drawn that far over the edge rather than wholly past it.
   */
  readonly foot: number;
  /**
   * The furthest left its box may start: the left edge of what of the canvas
   * is on screen, past which a tab stepped left would be drawn out of view.
   */
  readonly leftmost: number;
}

/** Where a tab is placed: on which edge, and how far in from the right. */
export interface TabPlacement {
  readonly at: TabAt;
  readonly side: number;
}

/**
 * The gap between two tabs stepped apart along one edge: the gap between one
 * at-rest mark's own tabs.
 */
const TAB_GAP = 2;

/** Whether two rectangles share any area: touching edges share none. */
export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * About where a tab is drawn, placed `at` its outline's edge and `side` in
 * from its right: right-anchored, drawn leftwards, its foot `foot` over the
 * edge it stands on.
 */
function tabBoxOf(draft: TabDraft, at: TabAt, side: number): Rect {
  const { edge, width, height, foot } = draft;
  const y =
    at === "above"
      ? edge.y - height + foot
      : at === "below"
        ? edge.y + edge.height - foot
        : edge.y;
  return { x: edge.x + edge.width - side - width, y, width, height };
}

/**
 * Where each tab goes so no two overlap, nor any overlaps a box already
 * `taken`: in the order the drafts are given.
 *
 * Each tab sits on its own outline's top edge, so on blocks drawn shorter
 * than a tab (a line of text at a zoomed-out canvas, a spacer) stacked one on
 * another, the lower block's tab lands on the upper one's: both run leftwards
 * from the same right edge, and the second covers the first. No rule one tab
 * can apply from its own block alone keeps two such tabs apart, since every
 * tab shifting alike shifts both, so the tabs are placed together, in a fixed
 * order: from the top of the page down, then from the left, the order given
 * breaking ties (an outer block before the one it holds, and one block's
 * at-rest tabs before its visitor badge, as the board lists the layers). The
 * first keeps its place alone. A later one that would overlap one already
 * placed, or a taken box, takes its next place in the order it may use
 * (above, below, inside its top), the first that is clear, so a short block
 * under another carries its tab on its bottom edge, still on its own outline.
 * Where every place it may use is taken, as in a stack of several very short
 * blocks, it keeps its first place and steps left along that edge, past what
 * it would cover. A tab that is clear is placed exactly as it is alone.
 */
export function tabsApart(
  drafts: readonly TabDraft[],
  taken: readonly Rect[] = []
): TabPlacement[] {
  const order = drafts
    .map((draft, index) => ({ block: draft.block, index }))
    .sort((a, b) => a.block.y - b.block.y || a.block.x - b.block.x)
    .map(({ index }) => index);
  const placed: Rect[] = [...taken];
  const placements: TabPlacement[] = drafts.map(draft => ({
    at: draft.places[0] ?? "inside",
    side: draft.side,
  }));
  for (const index of order) {
    const draft = drafts[index];
    if (draft === undefined) continue;
    const hit = (box: Rect): Rect | undefined =>
      placed.find(other => overlaps(box, other));
    const clear = draft.places.find(
      at => hit(tabBoxOf(draft, at, draft.side)) === undefined
    );
    const at = clear ?? draft.places[0] ?? "inside";
    let side = draft.side;
    let box = tabBoxOf(draft, at, side);
    // The furthest in from the outline's right edge it may step: its box then
    // starts at the screen's left edge. A tab stopped there may still cover
    // another, but it stays in view and reachable, where one stepped further
    // would be drawn, and its button placed, off the canvas.
    const furthest = Math.max(
      draft.side,
      draft.edge.x + draft.edge.width - draft.width - draft.leftmost
    );
    // Ends: each step leaves the tab wholly left of the box it hits, and it
    // only moves left, so no placed box is hit twice; or it reaches the
    // screen's left edge and stops.
    for (let over = hit(box); over !== undefined; over = hit(box)) {
      const next = draft.edge.x + draft.edge.width - (over.x - TAB_GAP);
      side = Math.min(next, furthest);
      box = tabBoxOf(draft, at, side);
      if (next >= furthest) break;
    }
    placed.push(box);
    placements[index] = { at, side };
  }
  return placements;
}

/** The layers that post to a board, in the order the pass lists them. */
export type TabLayer = "toolbar" | "at-rest" | "visitor";

const LAYERS: readonly TabLayer[] = ["toolbar", "at-rest", "visitor"];

/** What one layer posts: the tabs it places, and the boxes it keeps. */
export interface TabPost {
  readonly tabs: readonly TabDraft[];
  readonly taken: readonly Rect[];
}

const NOTHING_POSTED: TabPost = { tabs: [], taken: [] };

/** What one layer has posted, comparable, and how to tell it of another's post. */
interface Posted {
  readonly post: TabPost;
  readonly key: string;
  readonly heard: (() => void) | undefined;
}

/** One canvas root's board, which every layer drawn over it shares. */
interface TabBoard {
  /**
   * Replace what `layer` has posted; `heard` is called when another layer's
   * post changes the board. Tells the other layers when this one changes it.
   */
  post(layer: TabLayer, post: TabPost, heard?: () => void): void;
  /** Where `layer`'s posted tabs go, in the order it posted them. */
  placesOf(layer: TabLayer): TabPlacement[];
}

/** Per canvas root, so a root replaced (a page reloaded into the frame) starts clean. */
const BOARDS = new WeakMap<HTMLElement, TabBoard>();

function newBoard(): TabBoard {
  const posted = new Map<TabLayer, Posted>();
  return {
    post(layer, post, heard) {
      const key = JSON.stringify(post);
      const before = posted.get(layer);
      posted.set(layer, { post, key, heard });
      if (before?.key === key) return;
      // Placing only reads the board, so a layer told here posts nothing
      // back: one post is heard once by each other layer, and ends there.
      posted.forEach((other, name) => {
        if (name !== layer) other.heard?.();
      });
    },
    placesOf(layer) {
      const posts = LAYERS.map(name => ({
        name,
        post: posted.get(name)?.post ?? NOTHING_POSTED,
      }));
      const tabs = posts.flatMap(({ name, post }) =>
        post.tabs.map(draft => ({ name, draft }))
      );
      const placements = tabsApart(
        tabs.map(({ draft }) => draft),
        posts.flatMap(({ post }) => post.taken)
      );
      return placements.filter((_, index) => tabs[index]?.name === layer);
    },
  };
}

/** The board of the canvas drawn at `root`. */
export function tabBoardOf(root: HTMLElement): TabBoard {
  let board = BOARDS.get(root);
  if (board === undefined) {
    board = newBoard();
    BOARDS.set(root, board);
  }
  return board;
}

/**
 * Posts what a layer draws to the board of the canvas it is drawn over, and
 * takes it off again when the layer draws nothing there or is gone, so the
 * other layers stop keeping clear of it. `heard` places the layer's tabs again
 * from what it last measured, called when another layer's post changes the
 * board; the latest one given is called.
 *
 * Returns the post: given no root (the layer is over no canvas, or draws
 * nothing), it takes the layer's last post off its board.
 */
export function useTabPost(
  layer: TabLayer,
  heard?: () => void
): (root: HTMLElement | null, post?: TabPost) => void {
  const board = React.useRef<TabBoard | null>(null);
  const latest = React.useRef(heard);
  // Kept current after each render, so the board calls the layer's latest
  // placing rather than the one it posted with.
  React.useLayoutEffect(() => {
    latest.current = heard;
  });
  React.useEffect(
    () => () => {
      board.current?.post(layer, NOTHING_POSTED);
      board.current = null;
    },
    [layer]
  );
  return React.useCallback(
    (root: HTMLElement | null, post: TabPost = NOTHING_POSTED) => {
      const next = root === null ? null : tabBoardOf(root);
      if (board.current !== null && board.current !== next) {
        board.current.post(layer, NOTHING_POSTED);
      }
      board.current = next;
      next?.post(layer, post, () => latest.current?.());
    },
    [layer]
  );
}
