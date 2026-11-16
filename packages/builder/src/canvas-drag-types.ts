/**
 * What a canvas drag hands its callers: the thresholds, the subject in flight,
 * the state the canvas draws, the handlers it carries, and the options the hook
 * takes. `useCanvasDrag` in `canvas-drag.tsx` answers in these, and that module
 * still exports every one of them.
 *
 * @module canvas-drag-types
 */

import type {
  BlockNode,
  ComponentLookup,
  NestingSource,
} from "@nextlyhq/blocks-engine";
import type * as React from "react";

import type { DropRefusal, DropTarget } from "./drop-targets";
import type { EditorState } from "./editor-state";
import type { SlotSource } from "./inserter";
import type { LockDropRefusal } from "./lock-refusal";

/**
 * How far the pointer travels before a press becomes a drag.
 *
 * Large enough that the hand-shake in a deliberate click never reaches it, small
 * enough that a short drag still starts. The same order as the field's other
 * editors; the exact figure is not load-bearing, because the threshold only has
 * to separate a click from an intent to move.
 */
export const DEFAULT_ACTIVATION_PX = 4;

/**
 * How far a rival target must be held before it replaces the committed one.
 *
 * Measured as pointer TRAVEL rather than as a property of the blocks, which is
 * the whole reason this canvas can have hysteresis at all: `core/spacer` takes
 * its height from an author-set prop with no lower bound and `core/divider`
 * renders one pixel tall, so any rule keyed on a block's size makes some
 * authored block impossible to drop beside. Travel is a property of the gesture
 * and treats a 1px divider and a 900px hero identically.
 */
export const DEFAULT_SWITCH_PX = 8;

/**
 * What a drag is carrying: a node the document already holds, or a block type
 * that has no node yet.
 *
 * The two differ in exactly two places — whether anything is being detached,
 * and what the release commits — and are identical everywhere between. Holding
 * that as a payload rather than a second hook is what makes "one engine"
 * checkable rather than aspirational: `resolveDrop`, the switch rule,
 * autoscroll and the indicator cannot tell the kinds apart, because they are
 * never given the chance to.
 *
 * An insert builds its node from a THUNK the caller supplies rather than
 * resolving the type here. The palette reads its definitions from one snapshot
 * per mount and a block arrives with the children it declares, so resolving
 * again at drop would answer from a second reading — and the row the author
 * dragged could differ from the subtree that lands.
 */
export type DragSubject =
  | { readonly kind: "move"; readonly nodeId: string }
  | {
      readonly kind: "insert";
      readonly blockName: string;
      readonly makeNode: () => BlockNode | null;
      /**
       * Notified with the node that landed, after a drop the editor accepted.
       *
       * Carried on the subject so the two ways a palette inserts report the
       * same event. The panel already tells its host about a click insert, and
       * a host reacting to that — scrolling to the block, opening its settings
       * — would silently miss every insert made by dragging.
       */
      readonly onInserted?: (node: BlockNode) => void;
    };

/**
 * What a palette hands the drag when a row is pressed.
 *
 * Named rather than written inline at both the type and the implementation:
 * the two used to state it separately, and adding a field to one left the
 * other rejecting it.
 */
export interface InsertDragEntry {
  /** The block type in flight, which the drop position is resolved for. */
  blockName: string;
  /** Builds the node at the release, from the palette's own snapshot. */
  makeNode: () => BlockNode | null;
  /** Notified with the node that landed, after a drop the editor accepted. */
  onInserted?: (node: BlockNode) => void;
}

/** What a drag is doing right now, for the canvas to draw. */
export interface CanvasDragState {
  /**
   * The node being dragged, or null when no MOVE-drag is in flight.
   *
   * Null for the whole of an insert-drag as well as between drags: the block
   * has no node until the release makes one, and minting an id early to fill
   * this would hand the canvas an id addressing nothing in the document.
   */
  readonly draggingId: string | null;
  /**
   * The block type in flight, whichever kind of drag it is, or null when none
   * is.
   *
   * This is the field to ask "is a drag happening", because it is the only one
   * that does not assume the subject has a node. Anything gated on the id
   * instead is blind to a drag from the palette.
   */
  readonly draggingBlockName: string | null;
  /** Where a drop would land, or null when nowhere would accept it. */
  readonly target: DropTarget | null;
  /**
   * Why the region under the pointer will not take the block, or null.
   *
   * Distinct from a null target: the author has aimed at something, and saying
   * nothing tells them the editor did not notice.
   */
  readonly refusal: DropRefusal | LockDropRefusal | null;
}

/** The handlers the canvas root must carry for a drag to work. */
export interface CanvasDragHandlers {
  readonly onPointerDown: React.PointerEventHandler<HTMLElement>;
  readonly onPointerMove: React.PointerEventHandler<HTMLElement>;
  readonly onPointerUp: React.PointerEventHandler<HTMLElement>;
  readonly onPointerCancel: React.PointerEventHandler<HTMLElement>;
}

export interface CanvasDrag extends CanvasDragState {
  readonly handlers: CanvasDragHandlers;
  /**
   * Begin a drag whose subject is not in the document yet.
   *
   * Called from a PALETTE row's own `onPointerDown`, which is why it cannot be
   * {@link CanvasDragHandlers.onPointerDown}: that one takes the canvas root
   * from `event.currentTarget`, and for a press on a palette row the current
   * target is the row.
   *
   * Does nothing when no canvas root was supplied, which leaves the press
   * exactly as it was — the row's click still inserts, and that click is the
   * non-drag route WCAG 2.2 SC 2.5.7 requires. This only ever supplements it.
   */
  readonly beginInsertDrag: (
    event: React.PointerEvent<HTMLElement>,
    entry: InsertDragEntry
  ) => void;
}

export interface UseCanvasDragOptions {
  /** The editor whose document a drop edits. */
  editor: EditorState;
  /** Which child regions each block type declares. */
  slots: SlotSource;
  /** The nesting rule, asked before any position is offered. */
  nesting: NestingSource;
  /**
   * The definitions the canvas draws instances from, so a MOVED instance is
   * judged by the roots of the definition it draws rather than by its own
   * type, which the nesting rule cannot restrict. Absent, an instance moves
   * anywhere — the posture of a host that resolves nothing.
   */
  definitions?: ComponentLookup;
  /**
   * The canvas root, for a drag that begins outside it.
   *
   * Optional, and its absence means only that {@link CanvasDrag.beginInsertDrag}
   * does nothing: a host that never drags from a palette has no use for the
   * ref, and requiring it would make every existing caller supply a value to
   * satisfy a feature it does not mount.
   */
  canvasRoot?: React.RefObject<HTMLElement | null>;
  activationPx?: number;
  switchPx?: number;
}
