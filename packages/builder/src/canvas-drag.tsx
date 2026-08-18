"use client";

/**
 * Dragging a block on the canvas: the pointer, and the line that answers it.
 *
 * Decides nothing about WHERE a block may land — {@link resolveDrop} does that,
 * and {@link nextTargetSwitchState} decides when the answer is allowed to
 * change. This module is the seam between those rules and a browser: it reads
 * rectangles, tracks a gesture, and draws.
 *
 * ## Drag is an enhancement, never the only way
 *
 * WCAG 2.2 SC 2.5.7 requires any function operated by dragging to be reachable
 * without dragging, and SC 2.1.1 requires keyboard operability. Both are already
 * satisfied before this file exists: a block is selected by clicking and moved
 * with `alt+Arrow`, and each move is announced. So nothing here is a sole route
 * to anything, and nothing here announces — `keyboard-actions` owns the one
 * live region, and a second one would read one author's action twice.
 *
 * ## A press is not a drag
 *
 * The pointer must travel {@link DEFAULT_ACTIVATION_PX} before a press becomes a
 * drag. Without that threshold every click on a block is a zero-length drag that
 * commits a move to the position it already occupies, and the undo history fills
 * with edits the author never made.
 *
 * ## Rectangles are measured ONCE, when the drag begins
 *
 * The document cannot change mid-drag — this is the only gesture in flight — and
 * blocks do not move out of the way as the pointer passes, so the layout that
 * was measured is the layout the whole gesture sees. Re-reading every
 * `getBoundingClientRect` on each pointer move would force a reflow per frame to
 * learn nothing.
 *
 * They are stored in the canvas's own CONTENT coordinates — viewport rectangle
 * minus the root's, plus the root's scroll — so the snapshot survives the page
 * scrolling under it, and an indicator positioned absolutely inside the root
 * lands where the rectangles say. **Not** handled: content that reflows during a
 * drag, such as a lazily-loaded image resizing above the pointer.
 *
 * @module canvas-drag
 */

import type { NestingSource } from "@nextlyhq/blocks-engine";
import { findNode } from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import * as React from "react";

import { nodeIdFromEvent } from "./canvas";
import {
  collectRegions,
  movingSubtree,
  resolveDrop,
  type DropRefusal,
  type DropRegion,
  type DropTarget,
  type RectSource,
} from "./drop-targets";
import type { EditorState } from "./editor-state";
import type { Point, Rect } from "./geometry";
import { canvasContentPoint, canvasContentRect } from "./geometry-dom";
import type { SlotSource } from "./inserter";
import {
  nextTargetSwitchState,
  NO_TARGET,
  type TargetSwitchState,
} from "./target-switch";

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

/** What a drag is doing right now, for the canvas to draw. */
export interface CanvasDragState {
  /** The node being dragged, or null when no drag is in flight. */
  readonly draggingId: string | null;
  /** Where a drop would land, or null when nowhere would accept it. */
  readonly target: DropTarget | null;
  /**
   * Why the region under the pointer will not take the block, or null.
   *
   * Distinct from a null target: the author has aimed at something, and saying
   * nothing tells them the editor did not notice.
   */
  readonly refusal: DropRefusal | null;
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
}

export interface UseCanvasDragOptions {
  /** The editor whose document a drop edits. */
  editor: EditorState;
  /** Which child regions each block type declares. */
  slots: SlotSource;
  /** The nesting rule, asked before any position is offered. */
  nesting: NestingSource;
  activationPx?: number;
  switchPx?: number;
}

/** What a drag needs to remember, none of which renders. */
interface Gesture {
  readonly nodeId: string;
  readonly origin: Point;
  readonly regions: readonly DropRegion[];
  readonly rects: RectSource;
  readonly forbiddenParents: ReadonlySet<string>;
  readonly blockName: string;
  /** False until the pointer has travelled far enough to mean a drag. */
  active: boolean;
  switchState: TargetSwitchState;
  /** Targets by id, so the committed id resolves back to something drawable. */
  targets: Map<string, DropTarget>;
}

/**
 * Every rendered node's rectangle, read once.
 *
 * Compared in JavaScript rather than matched with a selector built from an id:
 * a node id reaches this from stored data, and interpolating it into
 * `querySelector` makes any character CSS treats specially either throw or,
 * worse, match a different element.
 */
function snapshotRects(root: HTMLElement): RectSource {
  const measured = new Map<string, Rect>();
  // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
  // that declares its iterator, and this package compiles without one.
  root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    const id = element.getAttribute(NODE_ID_ATTRIBUTE);
    if (id !== null) measured.set(id, canvasContentRect(element, root));
  });
  // The canvas's own box, measured through the SAME reader as the blocks
  // inside it. `scrollWidth`/`scrollHeight` describe the whole content rather
  // than the part on screen, and mixing them with a rectangle read means the
  // region and its children answer to two different measurements — which is
  // the disagreement this package keeps its geometry in one place to avoid.
  //
  // The visible box is also the correct extent for what it is used for: it
  // decides whether the POINTER is inside the canvas, and a pointer cannot be
  // over content that is scrolled out of view.
  const rootRect: Rect = canvasContentRect(root, root);
  return {
    rectOf: id => measured.get(id),
    rootRect: () => rootRect,
  };
}

/**
 * Wire pointer events on the canvas root to the drop rules.
 *
 * Returns handlers to spread onto the root and the state to draw. The canvas
 * owns the element; this owns the gesture.
 */
export function useCanvasDrag({
  editor,
  slots,
  nesting,
  activationPx = DEFAULT_ACTIVATION_PX,
  switchPx = DEFAULT_SWITCH_PX,
}: UseCanvasDragOptions): CanvasDrag {
  const gesture = React.useRef<Gesture | null>(null);
  const [state, setState] = React.useState<CanvasDragState>({
    draggingId: null,
    target: null,
    refusal: null,
  });

  // Read at event time rather than closed over, so a handler bound on one render
  // never patches a document that a later edit has already replaced.
  const latest = React.useRef({ editor, slots, nesting });
  latest.current = { editor, slots, nesting };

  const reset = React.useCallback(() => {
    gesture.current = null;
    setState({ draggingId: null, target: null, refusal: null });
  }, []);

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // The primary button only. A right-click opens a context menu and a
      // middle-click scrolls, and starting a drag from either takes a gesture
      // the browser has already given a meaning.
      if (event.button !== 0) return;

      const root = event.currentTarget;
      const nodeId = nodeIdFromEvent(event.target);
      if (nodeId === null) return;

      const { editor: current } = latest.current;
      const node = findNode(current.document.nodes, nodeId);
      if (node === undefined) return;

      // A locked block is one the author has asked the editor not to move. The
      // press is left alone rather than swallowed, so it still selects.
      if (node.locked === true) return;

      const rects = snapshotRects(root);
      gesture.current = {
        nodeId,
        origin: canvasContentPoint(event.clientX, event.clientY, root),
        regions: collectRegions(current.document, latest.current.slots, rects),
        rects,
        forbiddenParents: movingSubtree(current.document, nodeId),
        blockName: node.type,
        active: false,
        switchState: NO_TARGET,
        targets: new Map(),
      };
      // Capture on the ROOT, so a pointer that leaves the canvas keeps
      // delivering. Without it a drag that wanders outside simply stops
      // reporting, and the gesture ends wherever the pointer happened to exit.
      root.setPointerCapture(event.pointerId);
    },
    []
  );

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = gesture.current;
      if (drag === null) return;

      const root = event.currentTarget;
      const pointer = canvasContentPoint(event.clientX, event.clientY, root);

      if (!drag.active) {
        const travelled = Math.hypot(
          pointer.x - drag.origin.x,
          pointer.y - drag.origin.y
        );
        if (travelled < activationPx) return;
        drag.active = true;
        // Selecting on activation rather than on press: a press that turns out
        // to be a click is handled by the canvas's own click handler, and
        // selecting here as well would run the same decision twice.
        latest.current.editor.select(drag.nodeId);
      }

      const resolution = resolveDrop(
        {
          blockName: drag.blockName,
          forbiddenParents: drag.forbiddenParents,
          regions: drag.regions,
          rects: drag.rects,
          nesting: latest.current.nesting,
        },
        pointer
      );

      if (resolution.kind === "none") {
        // The pointer has left every region, which ENDS the aim rather than
        // proposing a different one — so it is not put through the switch rule.
        //
        // That rule exists to stop the committed target flickering between
        // RIVALS at a boundary, and it withholds any change until the pointer
        // has travelled: a target lost this way would go on being drawn, and a
        // release would commit it. Dragging a block off the canvas would then
        // drop it back onto the page, which is the opposite of what leaving
        // means. There are no rivals here, so there is nothing to smooth.
        drag.switchState = NO_TARGET;
        setState({ draggingId: drag.nodeId, target: null, refusal: null });
        return;
      }

      const candidate = resolution.kind === "target" ? resolution.target : null;
      if (candidate !== null) drag.targets.set(candidate.id, candidate);

      // A REFUSAL still goes through the switch rule as a null candidate. The
      // pointer is over something, so a boundary between a region that accepts
      // the block and one that does not is exactly the jitter the rule is for.
      drag.switchState = nextTargetSwitchState(
        drag.switchState,
        candidate === null ? null : candidate.id,
        pointer,
        switchPx
      );

      const committed = drag.switchState.committed;
      setState({
        draggingId: drag.nodeId,
        target:
          committed === null ? null : (drag.targets.get(committed) ?? null),
        // The refusal is NOT held to the threshold. It says why the region under
        // the pointer refuses the block, and delaying that would leave the
        // sentence describing a region the pointer has left.
        refusal: resolution.kind === "refused" ? resolution.refusal : null,
      });
    },
    [activationPx, switchPx]
  );

  const onPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = gesture.current;
      if (drag === null) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const committed = drag.switchState.committed;
      // ONE absent value, not two. Written as `null` for "nothing committed"
      // and `undefined` for "committed to something no longer drawable", the
      // guard below would have to exclude both — and excluding one reads as
      // complete, so a drag released over no target would reach `target.at`.
      const target =
        committed === null ? undefined : drag.targets.get(committed);
      // A press that never became a drag, or one released where nothing accepts
      // the block, ends without an edit. Committing "the last valid target" from
      // a pointer that has since moved off it would drop the block somewhere the
      // author was not pointing when they let go.
      if (drag.active && target !== undefined) {
        latest.current.editor.apply({
          kind: "move",
          id: drag.nodeId,
          to: target.at,
        });
      }
      reset();
    },
    [reset]
  );

  /*
   * Escape abandons the drag, listened for on the DOCUMENT rather than on the
   * canvas root.
   *
   * A key event goes to the FOCUSED element, and pointer capture does not move
   * focus — so during a drag the keyboard is still wherever it was, which for a
   * drag begun from the inserter is a search field. A handler on the canvas
   * would therefore never run for the gesture it exists to cancel.
   *
   * Registered only WHILE a drag is in flight, and in the capture phase so it
   * runs before whatever else claims Escape — the editor's chrome closes on it,
   * and closing the editor mid-drag is exactly what an author pressing Escape is
   * trying to avoid. Both are the reason `stopPropagation` is warranted here and
   * would not be on an always-registered listener.
   */
  const dragging = state.draggingId !== null;
  React.useEffect(() => {
    if (!dragging) return;
    const abandon = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      reset();
    };
    document.addEventListener("keydown", abandon, true);
    return () => {
      document.removeEventListener("keydown", abandon, true);
    };
  }, [dragging, reset]);

  return {
    ...state,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      // A cancel is the browser withdrawing the gesture — the pointer was
      // captured by something else, or the touch became a scroll. Dropping
      // there would commit a move the author never released.
      onPointerCancel: reset,
    },
  };
}

export interface DropIndicatorProps {
  /** Where a drop would land, or null to draw nothing. */
  target: DropTarget | null;
}

/**
 * The line showing where a dropped block will go.
 *
 * Positioned absolutely in the canvas's content coordinates, which is what the
 * rectangles were measured in — so it needs the canvas root to be a positioned
 * ancestor, and `builder-chrome.css` makes it one.
 *
 * `aria-hidden`, and deliberately: the equivalent keyboard move announces its
 * own outcome through the editor's one live region, and a second element
 * describing the same pointer gesture would be read alongside it. A pointer drag
 * is also self-describing to anyone who can see the line.
 */
export function DropIndicator({
  target,
}: DropIndicatorProps): React.JSX.Element | null {
  if (target === null) return null;

  // The line is drawn ACROSS the axis children are separated along: a region
  // stacking its children downward gets a horizontal rule, a row gets a
  // vertical one.
  const style: React.CSSProperties =
    target.axis === "y"
      ? {
          left: target.from,
          top: target.line,
          width: target.to - target.from,
        }
      : {
          left: target.line,
          top: target.from,
          height: target.to - target.from,
        };

  return (
    <div
      className="nx-drop-indicator"
      data-axis={target.axis}
      style={style}
      aria-hidden="true"
    />
  );
}
