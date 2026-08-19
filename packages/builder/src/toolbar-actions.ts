/**
 * What the floating toolbar offers for the selected block, and where it sits.
 *
 * The structural verbs — select the container, move up, move down, duplicate,
 * delete — exist already and are reachable only by keystroke. An author who has
 * never read a shortcut list has no way to discover that this editor can
 * duplicate a block at all, so the verbs are effectively absent for most of the
 * people using them. This module is the half of that fix which can be decided
 * without a DOM.
 *
 * ## Two questions, both pure
 *
 * **Which actions, and can they run.** Every answer is delegated: whether a
 * move is possible is `keyboardMovePosition`, whether a lock forbids it is
 * `lockBlockingMove` and `lockBlockingDelete`, whether a duplicate has a
 * position is `blockDuplication`. Nothing here re-derives any of those, because
 * a toolbar that decided for itself would eventually disagree with the
 * keystroke that does the same thing — and the author would meet the
 * disagreement as a button that looks available and does nothing.
 *
 * **Where the bar goes.** Above the block, falling back to below it, clamped
 * into the canvas. Separated from the rendering so the placement rules can be
 * asserted at sizes a jsdom test cannot produce: every rectangle in jsdom is
 * zero, so a placement computed inside a component is a placement no test can
 * see.
 *
 * ## Why a disabled button rather than a hidden one
 *
 * A toolbar whose buttons come and go changes width and order as the selection
 * moves, so the control an author is aiming at is somewhere else by the time
 * they arrive. Disabled buttons keep the bar one shape, and the reason is
 * carried with the action so the surface can say why rather than leaving the
 * author to guess.
 *
 * @module toolbar-actions
 */

import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";

import { blockDeletion } from "./delete-block";
import { blockDuplication } from "./duplicate-block";
import type { Rect } from "./geometry";
import { keyboardMovePosition } from "./keyboard-move";
import { layerLabel, pathTo } from "./layers";
import { lockBlockingDelete, lockBlockingMove } from "./locking";
import { isRefusal, selectionMove } from "./selection-ops";

/** The verbs the bar offers, in the order it draws them. */
export type ToolbarActionId =
  | "select-parent"
  | "move-up"
  | "move-down"
  | "duplicate"
  | "delete";

/** One button's worth of decision. */
export interface ToolbarAction {
  readonly id: ToolbarActionId;
  /**
   * The accessible name, which is also the tooltip.
   *
   * Fixed per verb rather than naming the block: the bar is drawn against the
   * block it acts on, so "Duplicate" is unambiguous there, and a name that grew
   * with the block's would reflow the bar on every selection.
   */
  readonly label: string;
  /** Whether pressing it would do anything. */
  readonly enabled: boolean;
  /**
   * Why it is disabled, phrased for an author, or `undefined` when enabled.
   *
   * Only ever set for a reason an author can act on. "This block is at the top
   * of its container" is a fact about the page they can see and is left unsaid;
   * a lock is the opposite, because nothing on the canvas explains it and the
   * remedy is one field away.
   */
  readonly reason?: string;
}

/**
 * What a lock refusal says.
 *
 * Names the block only when it is not the selected one. "Caption inside this
 * block is locked" sends an author somewhere to look; repeating the selected
 * block's own name back at them while the bar is drawn against it does not.
 */
function lockedBy(locked: BlockNode, selectedId: string): string {
  return locked.id === selectedId
    ? "This block is locked."
    : `${layerLabel(locked)} inside this block is locked.`;
}

/**
 * Whether a set can move one step, and what to say when it cannot.
 *
 * The plan itself is the answer: `selectionMove` already decides that a set
 * straddling two containers has nowhere to go and that one block at the edge
 * holds the rest, and asking it here keeps the bar agreeing with the keyboard
 * rather than testing those rules a second time.
 *
 * `null` is the edge of the container, which is dimmed WITHOUT a reason —
 * exactly as a single block at the end of its list is. Nothing needs saying
 * about a step that has nowhere to go.
 */
function moveAction(
  document: BlockDocument,
  ids: readonly string[],
  id: "move-up" | "move-down",
  label: string,
  direction: "up" | "down"
): ToolbarAction {
  const plan = selectionMove(document, ids, direction);
  if (plan === null) return { id, label, enabled: false };
  if (isRefusal(plan))
    return { id, label, enabled: false, reason: plan.reason };
  return { id, label, enabled: true };
}

/**
 * The bar for a selection holding more than one block.
 *
 * **Duplicate, delete and move keep their meaning; select-parent loses it.**
 * Copying six blocks is six copies each beside its own original, removing six
 * is removing six, and moving six that share a list is one step for each — all
 * three are the single-block verb repeated, which is what `selection-ops`
 * plans. "The parent" of blocks with different parents is not a block, so
 * select-parent has no answer to give and does not invent one.
 *
 * Move is offered but not always available: a set spread across two containers
 * has no shared list to step through, and that refusal carries a reason because
 * nothing on the page shows that the selection straddles a boundary.
 *
 * The bar keeps its five buttons and its one shape rather than shrinking. A
 * control that vanishes when a second block is selected moves every button
 * after it, so the one an author was aiming at is somewhere else by the time
 * they arrive — the same reason unavailable actions are dimmed rather than
 * hidden with a single block.
 */
function manyBlockActions(
  document: BlockDocument,
  ids: readonly string[]
): ToolbarAction[] {
  const many = `Only one block at a time. ${ids.length} are selected.`;
  const deleteLock = ids
    .map(id => lockBlockingDelete(document, id))
    .find(node => node !== undefined);

  return [
    {
      id: "select-parent",
      label: "Select parent",
      enabled: false,
      reason: many,
    },
    moveAction(document, ids, "move-up", "Move up", "up"),
    moveAction(document, ids, "move-down", "Move down", "down"),
    // A lock never stops a duplication, for a set as for one block: the
    // originals stay where they are.
    { id: "duplicate", label: "Duplicate", enabled: true },
    deleteLock === undefined
      ? { id: "delete", label: "Delete", enabled: true }
      : {
          id: "delete",
          label: "Delete",
          enabled: false,
          // ONE lock refuses the whole delete, because the group is applied
          // atomically and there is no half-done delete to fall back to.
          reason: `${layerLabel(deleteLock)} is locked. Unlock it to delete.`,
        },
  ];
}

/**
 * The toolbar's buttons for the current selection, or `[]` when there is none.
 *
 * `[]` also covers a selected id the document no longer holds, which an undo
 * produces routinely — the bar is drawn against an element, and there is no
 * element for a node that is gone.
 */
export function toolbarActions(
  document: BlockDocument,
  selectedId: string | null,
  /**
   * Every selected id. Defaults to the primary alone.
   *
   * Optional so a caller with one block — the command palette, a host that has
   * not adopted the set — keeps the same answer it had. What changes for a
   * SET is which verbs are well defined, not which rules decide them.
   */
  selectedIds?: readonly string[]
): ToolbarAction[] {
  if (selectedId === null) return [];

  const path = pathTo(document, selectedId);
  if (path.length === 0) return [];

  const ids = selectedIds ?? [selectedId];
  if (ids.length > 1) return manyBlockActions(document, ids);

  const moveLock = lockBlockingMove(document, selectedId);
  const deleteLock = lockBlockingDelete(document, selectedId);

  const canMove = (direction: "up" | "down"): boolean =>
    keyboardMovePosition(document.nodes, selectedId, direction) !== null;

  const move = (
    id: "move-up" | "move-down",
    label: string,
    direction: "up" | "down"
  ): ToolbarAction =>
    moveLock === undefined
      ? { id, label, enabled: canMove(direction) }
      : {
          id,
          label,
          enabled: false,
          reason: lockedBy(moveLock, selectedId),
        };

  return [
    {
      id: "select-parent",
      label: "Select parent",
      // The path always ends at the selection itself, so a length of one means
      // a top-level block with no container to step out to.
      enabled: path.length > 1,
    },
    move("move-up", "Move up", "up"),
    move("move-down", "Move down", "down"),
    {
      id: "duplicate",
      label: "Duplicate",
      // A lock deliberately does not stop this. Duplicating neither moves nor
      // removes the original, and refusing would mean an author could not take
      // a copy of the one block they had most deliberately protected — the same
      // reading the keyboard duplicate takes.
      enabled: blockDuplication(document, selectedId) !== null,
    },
    deleteLock === undefined
      ? {
          id: "delete",
          label: "Delete",
          enabled: blockDeletion(document, selectedId) !== null,
        }
      : {
          id: "delete",
          label: "Delete",
          enabled: false,
          reason: lockedBy(deleteLock, selectedId),
        },
  ];
}

/**
 * The smallest rectangle containing all of them, or `undefined` for none.
 *
 * What a floating bar anchors to once a selection can hold several blocks. The
 * PRIMARY's rectangle would be the easy choice and is the wrong one: with two
 * blocks selected at opposite ends of a page, a bar drawn at one of them
 * describes an action that is about to happen to both, and the author cannot
 * see the other. The union is the shape the selection actually occupies.
 */
export function unionRect(rects: readonly Rect[]): Rect | undefined {
  const [first, ...rest] = rects;
  if (first === undefined) return undefined;

  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;

  for (const rect of rest) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** How big the bar measured, in canvas content pixels. */
export interface ToolbarSize {
  readonly width: number;
  readonly height: number;
}

/** Where the bar is drawn, and which side of the block it landed on. */
export interface ToolbarPlacement {
  readonly x: number;
  readonly y: number;
  readonly side: "above" | "below";
}

/** The gap between the bar and the block it names, in pixels. */
export const TOOLBAR_GAP_PX = 6;

/**
 * Where to draw the bar for a block, in the canvas's own content coordinates.
 *
 * **Above by default, below when there is no room.** Above keeps the bar off
 * the block's own content, which is what an author is looking at; the first
 * block on a page has nothing above it, and a bar clamped to the canvas top
 * would sit ON that block instead of beside it.
 *
 * **Left-aligned to the block, never centred.** A centred bar moves whenever
 * the block's width changes — which happens while an author is editing its
 * padding — so the button they are reaching for slides out from under the
 * pointer. The leading edge is the one part of a block that stays put.
 *
 * **Clamped horizontally, never vertically.** A bar pushed off the right edge
 * is unreachable, so it slides back in. Vertical overflow is handled by the
 * side flip above rather than by clamping, because a clamped bar overlaps the
 * block and a flipped one does not.
 */
export function toolbarPlacement(
  block: Rect,
  toolbar: ToolbarSize,
  canvas: ToolbarSize,
  gap: number = TOOLBAR_GAP_PX
): ToolbarPlacement {
  const above = block.y - toolbar.height - gap;
  const below = block.y + block.height + gap;

  // Below only when above would leave the canvas. A block near the BOTTOM keeps
  // the bar above it, where it is still visible — flipping there would push it
  // under the fold for no gain.
  const side: "above" | "below" = above >= 0 ? "above" : "below";

  // The clamp is skipped when the bar is wider than the canvas, because there
  // is no position that satisfies both edges and clamping would silently choose
  // the right one — leaving the first buttons, which are the ones an author
  // reaches for, off-screen.
  const maxX = canvas.width - toolbar.width;
  const x = maxX <= 0 ? 0 : Math.min(Math.max(block.x, 0), maxX);

  return { x, y: side === "above" ? above : below, side };
}
