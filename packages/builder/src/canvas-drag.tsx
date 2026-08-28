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

import type { BlockNode, NestingSource } from "@nextlyhq/blocks-engine";
import { findNode } from "@nextlyhq/blocks-engine";
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import * as React from "react";

import { autoscrollStep } from "./autoscroll";
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
import {
  canvasContentPoint,
  canvasContentRect,
  canvasPointerPoints,
  containerEdges,
  scrollableAncestor,
  type CanvasPointerPoints,
} from "./geometry-dom";
import type { SlotSource } from "./inserter";
import { lockBlockingMove } from "./locking";
import type { OpPosition } from "./ops";
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

/**
 * Hand the pointer back, when this transport is the one holding it.
 *
 * A node-origin drag captures on the canvas root; a palette drag captures
 * nowhere and passes `null`. Asked of the element rather than tracked, because
 * the browser releases capture itself on some endings and a flag would then
 * describe a capture that is already gone.
 */
function releaseCapture(host: HTMLElement | null, pointerId: number): void {
  if (host !== null && host.hasPointerCapture(pointerId)) {
    host.releasePointerCapture(pointerId);
  }
}

/**
 * The target a release would commit to, or `undefined` when there is none.
 *
 * ONE absent value, not two. Written as `null` for "nothing committed" and
 * `undefined` for "committed to something no longer drawable", the caller
 * would have to exclude both — and excluding one reads as complete, so a drag
 * released over no target would reach `target.at`.
 */
function committedTarget(drag: Gesture): DropTarget | undefined {
  const committed = drag.switchState.committed;
  return committed === null ? undefined : drag.targets.get(committed);
}

/** What a drag needs to remember, none of which renders. */
interface Gesture {
  readonly subject: DragSubject;
  /**
   * The pointer that began this gesture, and the only one that may drive it.
   *
   * A node-origin drag takes pointer capture, which retargets one pointer and
   * leaves the rest alone — so this is redundant there and costs nothing. A
   * palette drag deliberately takes no capture, because the browser resolves a
   * click against the capturing element and the row must keep inserting on
   * click. Its events therefore arrive by two transports, the canvas's own
   * React handlers and the document listeners, and BOTH see every active
   * pointer on a touch device.
   *
   * Kept on the gesture rather than checked in each transport's closure: the
   * two entry points below are where every pointer event of either transport
   * converges, so enforcing it there covers a route a closure check would
   * miss — a second finger moving over the CANVAS reaches the React handler,
   * not the document listener.
   */
  readonly owner: number;
  readonly origin: Point;
  /**
   * Where the press landed in CLIENT pixels.
   *
   * Kept beside {@link origin} rather than derived from it, because the two
   * answer different questions and a scaled canvas separates them. `origin` is
   * in the canvas's own content coordinates, which is what a hit test needs;
   * the thresholds below are about how far a HAND moved, which is a fact about
   * the person and not about the document's coordinate system.
   *
   * Measured in content pixels they shrink with the canvas: at a canvas painted
   * to 71%, the 4px that separates a click from a drag needs only 2.85px of
   * real movement, so ordinary click jitter starts committing moves — and the
   * target hysteresis loosens by the same factor at the same time.
   */
  readonly originClient: Point;
  readonly regions: readonly DropRegion[];
  readonly rects: RectSource;
  readonly forbiddenParents: ReadonlySet<string>;
  readonly blockName: string;
  /** False until the pointer has travelled far enough to mean a drag. */
  active: boolean;
  switchState: TargetSwitchState;
  /** Targets by id, so the committed id resolves back to something drawable. */
  targets: Map<string, DropTarget>;
  /**
   * The canvas root, kept so a frame with no pointer event still has it.
   *
   * Autoscroll runs between moves — a pointer resting in the edge band produces
   * no events at all — so the element cannot come from `event.currentTarget`
   * the way every other read here does.
   */
  readonly root: HTMLElement;
  /**
   * The element that actually scrolls, or `null` when nothing does.
   *
   * Resolved once at drag start rather than per frame: it is a walk up the tree
   * reading computed styles, and the answer cannot change mid-gesture.
   */
  readonly scroller: HTMLElement | null;
  /** The last pointer position, in CLIENT coordinates. */
  clientX: number;
  clientY: number;
  /** The scheduled frame, or `null` when no loop is running. */
  frame: number | null;
}

/**
 * The identity half of {@link CanvasDragState}, for whichever subject is in
 * flight.
 *
 * Derived in one place rather than spelled out at each `setState`, so the two
 * fields cannot drift into disagreeing about whether a drag is happening: an
 * insert has no `draggingId`, and a site that set the id alone would report no
 * drag at all to everything gated on the block name.
 */
function drawnSubject(drag: Gesture): {
  draggingId: string | null;
  draggingBlockName: string;
} {
  return {
    draggingId: drag.subject.kind === "move" ? drag.subject.nodeId : null,
    draggingBlockName: drag.blockName,
  };
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
  canvasRoot,
  activationPx = DEFAULT_ACTIVATION_PX,
  switchPx = DEFAULT_SWITCH_PX,
}: UseCanvasDragOptions): CanvasDrag {
  const gesture = React.useRef<Gesture | null>(null);
  const [state, setState] = React.useState<CanvasDragState>({
    draggingId: null,
    draggingBlockName: null,
    target: null,
    refusal: null,
  });

  // Read at event time rather than closed over, so a handler bound on one render
  // never patches a document that a later edit has already replaced.
  const latest = React.useRef({ editor, slots, nesting });
  latest.current = { editor, slots, nesting };

  /**
   * Undo the document-level listening an insert-drag needs, or nothing.
   *
   * Held as a closure rather than as three named handlers, because the
   * functions to remove are the exact ones that were added — re-deriving them
   * would remove nothing and leave the gesture listening for ever.
   */
  const detachDocument = React.useRef<(() => void) | null>(null);
  const stopTrackingDocument = React.useCallback(() => {
    detachDocument.current?.();
    detachDocument.current = null;
  }, []);

  /**
   * End the gesture and release everything it holds, WITHOUT drawing.
   *
   * Split from {@link reset} for the one ending that cannot draw: a host
   * unmounting mid-drag, where a `setState` would be an update to a component
   * that no longer exists. Every other ending wants the redraw and goes through
   * `reset`, which is this plus that.
   *
   * Cancelling the frame here rather than in each ending is what stops a scroll
   * loop outliving the gesture it scrolls for: `pump` reschedules itself every
   * frame and only stops when it finds no active gesture, so leaving
   * `gesture.current` populated on unmount keeps it running — holding the
   * editor and the DOM, and still scrolling a canvas whose editor has closed.
   */
  const teardown = React.useCallback(() => {
    const running = gesture.current?.frame;
    if (running !== null && running !== undefined) {
      cancelAnimationFrame(running);
    }
    gesture.current = null;
    // A palette drag listens on the document, and every way one can end arrives
    // here.
    stopTrackingDocument();
  }, [stopTrackingDocument]);

  const reset = React.useCallback(() => {
    teardown();
    setState({
      draggingId: null,
      draggingBlockName: null,
      target: null,
      refusal: null,
    });
  }, [teardown]);

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
      //
      // Asked through the shared rule rather than by reading the flag here: the
      // keyboard moves and delete ask the same question, and delete's answer
      // differs — it checks the whole subtree, because removing a container
      // destroys what is inside it. Three inline reads of `node.locked` would
      // agree until one of them gained that distinction.
      if (lockBlockingMove(current.document, nodeId) !== undefined) return;

      const rects = snapshotRects(root);
      gesture.current = {
        subject: { kind: "move", nodeId },
        owner: event.pointerId,
        origin: canvasContentPoint(event.clientX, event.clientY, root),
        originClient: { x: event.clientX, y: event.clientY },
        regions: collectRegions(current.document, latest.current.slots, rects),
        rects,
        forbiddenParents: movingSubtree(current.document, nodeId),
        blockName: node.type,
        active: false,
        switchState: NO_TARGET,
        targets: new Map(),
        root,
        scroller: scrollableAncestor(root),
        clientX: event.clientX,
        clientY: event.clientY,
        frame: null,
      };
      // NOT captured here. See the activation branch in `onPointerMove`.
    },
    []
  );

  /**
   * Re-aim the drag at a pointer position, and draw the result.
   *
   * Shared by the pointer handler and the autoscroll frame because they ask the
   * same question at different moments: a move changes where the pointer is, and
   * a scroll changes what is under it. Computing the answer twice is how the
   * indicator and the committed target come apart — the frame would draw one
   * thing and the release would apply another.
   *
   * Takes the pointer already MAPPED, in both spaces, rather than mapping it
   * here. Both callers hold a rectangle of the root at the instant they aim —
   * the move because it has just measured, the frame because it has just
   * scrolled — and measuring again inside would answer this one drag step from
   * two rectangles: `resolveDrop` placing the pointer among the snapshotted
   * blocks by one, and the switch rule measuring travel by the other.
   */
  const aim = React.useCallback(
    (drag: Gesture, pointer: CanvasPointerPoints) => {
      const resolution = resolveDrop(
        {
          blockName: drag.blockName,
          forbiddenParents: drag.forbiddenParents,
          regions: drag.regions,
          rects: drag.rects,
          nesting: latest.current.nesting,
        },
        // CONTENT coordinates: the rects were snapshotted in that space at drag
        // start, and a scroll deliberately does not invalidate them.
        pointer.content
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
        setState({ ...drawnSubject(drag), target: null, refusal: null });
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
        /*
         * PAINTED pixels relative to the canvas, which is the only space that
         * answers both halves of this rule.
         *
         * The threshold is how far a HAND must move to overrule a committed
         * target, so it cannot be measured in canvas coordinates: those are
         * divided by the scale, and the hysteresis would loosen as the canvas
         * zoomed out. But it cannot be measured in client coordinates either —
         * autoscroll moves the page under a STATIONARY pointer, so the distance
         * from the anchor would stay zero however far the page travelled, and
         * the committed target would never advance off a position that has
         * scrolled away.
         *
         * Painted coordinates are undivided, so the threshold stays about the
         * hand, and they move with the scroll because the root's own rectangle
         * does.
         *
         * The same measurement the content point above came from, so the
         * position this rule anchors on and the position the drop was resolved
         * at are one pointer rather than two.
         */
        pointer.painted,
        switchPx
      );

      const committed = drag.switchState.committed;
      setState({
        ...drawnSubject(drag),
        target:
          committed === null ? null : (drag.targets.get(committed) ?? null),
        // The refusal is NOT held to the threshold. It says why the region under
        // the pointer refuses the block, and delaying that would leave the
        // sentence describing a region the pointer has left.
        refusal: resolution.kind === "refused" ? resolution.refusal : null,
      });
    },
    [switchPx]
  );

  /**
   * Scroll the canvas while the pointer rests near an edge, and keep aiming.
   *
   * A drag can only drop where it can point, so without this a block cannot be
   * moved anywhere outside the visible band of a long page — the position it
   * would land at never comes on screen.
   *
   * **Re-aiming is not optional.** The pointer may not move at all while this
   * runs, and the rects were measured once at drag start in CONTENT coordinates,
   * which scrolling deliberately does not invalidate. What changes is which of
   * them the pointer is over, so a frame that scrolled without re-aiming would
   * slide the page beneath a frozen indicator.
   *
   * The loop runs for as long as the drag does rather than starting and stopping
   * with the band, because a pointer held still inside it produces no events to
   * restart on.
   */
  const pump = React.useCallback(() => {
    const drag = gesture.current;
    if (drag === null || !drag.active) return;

    const scroller = drag.scroller;
    if (scroller === null) return;

    // The SCROLLER's edges, not the canvas root's. The root grows to its
    // content, so once a page is long enough to need scrolling its bottom edge
    // is somewhere below the window and a band measured against it never
    // contains the pointer — the case autoscroll exists for is exactly the case
    // that would stop working.
    const edges = containerEdges(scroller);
    const step = autoscrollStep(drag.clientY, edges.top, edges.bottom);
    if (step !== 0) {
      const before = scroller.scrollTop;
      scroller.scrollTop = before + step;
      // Only when the scroll actually moved. At either end of the content the
      // assignment is clamped to what it already was, and re-aiming then costs
      // a full resolve per frame to arrive at the answer already on screen.
      if (scroller.scrollTop !== before) {
        // Measured AFTER the assignment above, which is the one thing in this
        // module that moves the canvas: the root's rectangle has just travelled
        // and the pointer has to be placed against where it is now.
        aim(drag, canvasPointerPoints(drag.clientX, drag.clientY, drag.root));
      }
    }
    drag.frame = requestAnimationFrame(pump);
  }, [aim]);

  /**
   * Advance the gesture to a pointer position, activating it first if the
   * pointer has now travelled far enough to mean a drag.
   *
   * Takes the position, the pointer and the capturing element as arguments
   * rather than an event, because one gesture is fed from two transports:
   * React's handlers on the canvas root for a drag that began on a block, and
   * document-level listeners for one that began on a palette row, whose events
   * never reach the canvas at all. Both arrive here, and nothing below can tell
   * which did — which is the whole of what "one engine" buys.
   */
  const trackMove = React.useCallback(
    (
      clientX: number,
      clientY: number,
      pointerId: number,
      captureHost: HTMLElement | null
    ) => {
      const drag = gesture.current;
      if (drag === null) return;
      // Another finger, moving anywhere. It may not re-aim this gesture.
      if (pointerId !== drag.owner) return;

      /*
       * ONE measurement of the root, answering this move in both spaces.
       *
       * Against `drag.root`, not `event.currentTarget`: the rects were
       * snapshotted against the element the press landed on, and the frame loop
       * re-aims against it too, so that is the element this pointer has to be
       * expressed relative to. Capture makes the two the same element for the
       * whole of a drag, which is why reading either used to work.
       *
       * The pair stays true for the rest of this handler because nothing below
       * moves the canvas: the assignments are bookkeeping, `setPointerCapture`
       * retargets events rather than laying anything out, `requestAnimationFrame`
       * only schedules, and `select` and the draw inside `aim` are React state
       * that flushes after this returns. The one thing that DOES move layout is
       * `pump`'s scroll, and it runs in a frame callback of its own, so it
       * cannot land between this read and the aim below. Anything added here
       * that scrolls, resizes or writes a style invalidates the pair and has to
       * measure again.
       */
      const pointer = canvasPointerPoints(clientX, clientY, drag.root);
      // Recorded for the frame loop, which runs between moves and has no event
      // of its own to read a position from.
      drag.clientX = clientX;
      drag.clientY = clientY;

      if (!drag.active) {
        // CLIENT pixels: the threshold separates a click from an intent to
        // move, which is a property of the hand rather than of the canvas's
        // scale. Measured in content pixels it shrinks with the canvas.
        const travelled = Math.hypot(
          clientX - drag.originClient.x,
          clientY - drag.originClient.y
        );
        if (travelled < activationPx) return;
        drag.active = true;
        /*
         * Capture the pointer HERE rather than on the press, so that a press
         * which stays a click never captures at all.
         *
         * Capture retargets every later pointer event to the capturing element,
         * and the browser derives a `click`'s target from where the press and
         * the release landed — so capturing on `pointerdown` makes every click
         * on the canvas report the CANVAS ROOT as its target. The canvas
         * resolves a click by walking up from the target to the nearest block,
         * finds none above the root, and reads that as "the author clicked the
         * background": selecting a block by clicking it cleared the selection
         * instead.
         *
         * A drag needs capture because it may leave the canvas and must keep
         * receiving moves. A click does not, and until the pointer has travelled
         * far enough there is no way to tell which one this is — so the capture
         * waits for the answer.
         */
        //
        // Only when there IS a host to capture on. A drag from the palette is
        // followed on the document instead, and must NOT capture: the browser
        // derives a click's target from the capturing element, so capturing on
        // a palette row would report a click on that row wherever the author
        // released — and the row inserts on click.
        captureHost?.setPointerCapture(pointerId);
        // Started once, at activation. A press that stays a click never scrolls.
        drag.frame = requestAnimationFrame(pump);
        // Selecting on activation rather than on press: a press that turns out
        // to be a click is handled by the canvas's own click handler, and
        // selecting here as well would run the same decision twice.
        //
        // Only a move has something to select. An insert's node does not exist
        // until the release commits it, and it is selected there instead.
        if (drag.subject.kind === "move") {
          latest.current.editor.select(drag.subject.nodeId);
        }
      }

      aim(drag, pointer);
    },
    [activationPx, aim, pump]
  );

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      trackMove(
        event.clientX,
        event.clientY,
        event.pointerId,
        event.currentTarget
      );
    },
    [trackMove]
  );

  /**
   * Write the drop, and it is the ONE place the two subjects diverge.
   *
   * Everything that decided WHERE — `resolveDrop`, the switch rule, autoscroll,
   * the indicator — ran without being told which kind this was. That is the
   * testable content of the claim that the palette and the canvas share an
   * engine: a second implementation would have to reach this same call, and a
   * fork announces itself by not doing so.
   *
   * Exactly ONE op either way, applied at the release. Materialising a node at
   * drag-start and moving it instead would leave two entries on the undo stack
   * and put a block into the document mid-gesture, where every autosave and
   * unsaved-work signal reads a document reference that changed.
   */
  const commitDrop = React.useCallback(
    (subject: DragSubject, at: OpPosition) => {
      const { editor: current } = latest.current;
      if (subject.kind === "move") {
        current.apply({ kind: "move", id: subject.nodeId, to: at });
        return;
      }

      // Built at the release, from the caller's own snapshot of the palette.
      const node = subject.makeNode();
      if (node === null) return;
      // The position and the nesting verdict were both computed for the type
      // the gesture ADVERTISED. A node of some other type was never asked
      // about, so inserting it here would place a block into a parent or slot
      // that may forbid it — and the op layer checks structural shape, not the
      // nesting rule, so nothing downstream would catch it.
      //
      // Declined rather than re-resolved: the target was chosen for a different
      // block, so there is no position here that was ever offered for this one.
      if (node.type !== subject.blockName) return;
      // `apply` answers null when the op is refused, and a refusal must not be
      // followed by a select: the panel offers only placements the rule
      // permits, so a null here means the document moved under the gesture.
      if (current.apply({ kind: "insert", node, at }) === null) return;
      // Selecting what was just added is what makes a SECOND insert land after
      // it rather than stacking at one point — the same rule the panel's click
      // path states. It holds because `apply` publishes the document the next
      // `select` resolves against before it returns.
      current.select(node.id);
      // After the select, so a host reacting to this sees the editor in the
      // state the click path leaves it in — the same event, whichever way the
      // block arrived.
      subject.onInserted?.(node);
    },
    []
  );

  /**
   * Detaches whatever click suppression is armed, or null when none is.
   *
   * Held in a ref rather than left to each closure so that only ONE can be
   * armed: a second arming replaces the first instead of stacking listeners
   * that would each swallow a click.
   */
  const detachClickSwallow = React.useRef<(() => void) | null>(null);

  const stopSwallowingClick = React.useCallback(() => {
    detachClickSwallow.current?.();
    detachClickSwallow.current = null;
  }, []);

  /**
   * Swallow the click the browser synthesises after an activated palette drag.
   *
   * A palette row inserts on click and must go on doing so — that click is the
   * non-drag route. But a drag that begins and ends on the same row is still a
   * press and a release on one element, so a click is reported, and the row
   * would insert a SECOND block at the panel's own position beside the one the
   * drop just committed.
   *
   * Registered for one event in the capture phase, and removed whether or not
   * it fires: a drag released over the canvas produces no click on the row at
   * all, and a listener left waiting would eat the author's next unrelated
   * click. The release and its click belong to one task, so anything still
   * listening a task later was never going to fire.
   */
  const swallowNextClick = React.useCallback(() => {
    stopSwallowingClick();
    const stop = (): void => {
      document.removeEventListener("click", swallow, true);
      detachClickSwallow.current = null;
    };
    const swallow = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    document.addEventListener("click", swallow, true);
    setTimeout(stop, 0);
    detachClickSwallow.current = stop;
  }, [stopSwallowingClick]);

  /**
   * Swallow the click that will follow a pointer STILL DOWN when it releases.
   *
   * {@link swallowNextClick} arms for one task, which is right when the release
   * has already happened: the click the browser synthesises belongs to the same
   * task, so anything still listening a task later was never going to fire.
   *
   * Escape is the other case, and the one-task version is wrong for it. The
   * author cancels while the finger is still on the row, and the release — with
   * its click — arrives in some later task of their choosing. Expiring after
   * the keydown leaves the row's own handler to insert a block from a drag that
   * was visibly cancelled.
   *
   * So this waits for THAT pointer's release, and only then gives the click its
   * one task. Scoped to the pointer for the same reason the gesture is: another
   * finger lifting says nothing about this one.
   */
  const swallowClickAfterRelease = React.useCallback(
    (pointerId: number) => {
      stopSwallowingClick();
      const stop = (): void => {
        document.removeEventListener("click", swallow, true);
        document.removeEventListener("pointerup", released, true);
        document.removeEventListener("pointercancel", released, true);
        detachClickSwallow.current = null;
      };
      const swallow = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        stop();
      };
      const released = (event: PointerEvent): void => {
        if (event.pointerId !== pointerId) return;
        document.removeEventListener("pointerup", released, true);
        document.removeEventListener("pointercancel", released, true);
        // The click belongs to the release's task. Given it, and no longer:
        // a suppressor left armed would eat an unrelated click later.
        setTimeout(stop, 0);
      };
      document.addEventListener("click", swallow, true);
      document.addEventListener("pointerup", released, true);
      document.addEventListener("pointercancel", released, true);
      detachClickSwallow.current = stop;
    },
    [stopSwallowingClick]
  );

  /**
   * End the gesture, committing an edit only if it reached a target.
   *
   * Fed from both transports for the same reason {@link trackMove} is.
   */
  const endGesture = React.useCallback(
    (pointerId: number, captureHost: HTMLElement | null) => {
      const drag = gesture.current;
      if (drag === null) return;
      // Another finger lifting. Ending here would commit THIS gesture's target
      // while the finger that owns it is still down.
      if (pointerId !== drag.owner) return;
      releaseCapture(captureHost, pointerId);

      const target = committedTarget(drag);
      // A press that never became a drag, or one released where nothing accepts
      // the block, ends without an edit. Committing "the last valid target" from
      // a pointer that has since moved off it would drop the block somewhere the
      // author was not pointing when they let go.
      if (drag.active && target !== undefined) {
        commitDrop(drag.subject, target.at);
      }
      // Only after a drag that ACTIVATED. A press that stayed a click must keep
      // its click — that is the row's ordinary insert, and eating it would take
      // away the non-drag path rather than the duplicate.
      if (drag.active && drag.subject.kind === "insert") swallowNextClick();
      reset();
    },
    [commitDrop, reset, swallowNextClick]
  );

  const onPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      endGesture(event.pointerId, event.currentTarget);
    },
    [endGesture]
  );

  const beginInsertDrag = React.useCallback(
    (event: React.PointerEvent<HTMLElement>, entry: InsertDragEntry) => {
      // The primary button only, for the reason `onPointerDown` gives.
      if (event.button !== 0) return;
      const root = canvasRoot?.current ?? null;
      // Nothing to drop onto. The press is left entirely alone rather than
      // half-started, so the row's click still inserts by the ordinary path.
      if (root === null) return;

      const { editor: current, slots } = latest.current;
      const rects = snapshotRects(root);
      gesture.current = {
        owner: event.pointerId,
        subject: {
          kind: "insert",
          blockName: entry.blockName,
          makeNode: entry.makeNode,
          onInserted: entry.onInserted,
        },
        origin: canvasContentPoint(event.clientX, event.clientY, root),
        originClient: { x: event.clientX, y: event.clientY },
        regions: collectRegions(current.document, slots, rects),
        rects,
        // EMPTY, and this is the other place the kinds differ. Forbidden
        // parents exist to stop a node being dropped inside itself; nothing is
        // being detached here, so there is no subtree to exclude.
        forbiddenParents: new Set<string>(),
        blockName: entry.blockName,
        active: false,
        switchState: NO_TARGET,
        targets: new Map(),
        root,
        scroller: scrollableAncestor(root),
        clientX: event.clientX,
        clientY: event.clientY,
        frame: null,
      };

      /*
       * Followed on the DOCUMENT for the whole gesture, not merely once it
       * activates.
       *
       * The press landed on a palette row, and that row is not an ancestor of
       * the canvas — so the canvas root's handlers never see this pointer, and
       * the row itself stops seeing it the moment the pointer leaves. Capture
       * would fix the second half and cost something worse, for the reason
       * given at the capture in `trackMove`.
       *
       * The same conclusion the Escape listener below already reached, whose
       * docblock names a drag begun from the inserter as its reason for
       * listening here rather than on the canvas.
       */
      /*
       * Only the pointer that began this gesture drives it.
       *
       * The node-origin path gets this from pointer capture, which retargets
       * one pointer and ignores the rest. A palette drag deliberately takes no
       * capture, so its document listeners see EVERY active pointer: on a
       * touch device, lifting a second finger would otherwise commit the first
       * finger's target, and a second finger's movement would aim the drag.
       */
      const owner = event.pointerId;
      const move = (native: PointerEvent): void => {
        trackMove(native.clientX, native.clientY, native.pointerId, null);
      };
      const up = (native: PointerEvent): void => {
        endGesture(native.pointerId, null);
      };
      // `cancel` alone checks the pointer here, because it is the one ending
      // that does not pass through `trackMove` or `endGesture` — the two both
      // transports converge on, and where ownership is enforced for everything
      // else. Repeating that check in these closures would put the same rule
      // in two places, and the copy that mattered would be the one someone
      // forgot when a third transport arrived.
      const cancel = (native: PointerEvent): void => {
        if (native.pointerId !== owner) return;
        reset();
      };
      // Before registering, never after: overwriting the detach closure below
      // while an earlier palette gesture is still live would strand its three
      // listeners with nothing able to remove them, and they would go on
      // calling into a gesture they no longer own for the life of the page.
      //
      // The ordinary sequence cannot reach that — a release arrives first and
      // resets — so this holds the invariant locally instead of resting it on
      // an ordering that a lost release or a second pointer breaks.
      stopTrackingDocument();
      document.addEventListener("pointermove", move, true);
      document.addEventListener("pointerup", up, true);
      document.addEventListener("pointercancel", cancel, true);
      detachDocument.current = () => {
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("pointerup", up, true);
        document.removeEventListener("pointercancel", cancel, true);
      };
    },
    [canvasRoot, endGesture, reset, stopTrackingDocument, trackMove]
  );

  // Every ordinary ending funnels through `reset`. This covers the one that
  // does not: a host unmounting mid-drag, which would otherwise leave a running
  // frame loop and three document listeners holding a gesture nothing can end.
  // `teardown` rather than `reset`, because a state update here would be one on
  // a component that has gone.
  React.useEffect(() => {
    return () => {
      teardown();
      // Cleared HERE and not in `teardown`: Escape arms the suppression and
      // then resets, so disarming on every ending would undo it in the one
      // case it exists for.
      stopSwallowingClick();
    };
  }, [teardown, stopSwallowingClick]);

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
  // Gated on the block name rather than the id: an insert-drag has no node, so
  // a gate on `draggingId` would leave the palette's own drag — the very
  // gesture the docblock above names as its reason for existing — with no way
  // to be cancelled.
  const dragging = state.draggingBlockName !== null;
  React.useEffect(() => {
    if (!dragging) return;
    const abandon = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      // An abandoned palette drag still ends in a release, and if the pointer
      // has come back to the row it started on, that press and release are one
      // click — which the row inserts on. Escape would visibly cancel the drag
      // and add a block anyway, so this ending needs the same suppression the
      // committed one gets.
      const drag = gesture.current;
      if (drag?.active === true && drag.subject.kind === "insert") {
        swallowClickAfterRelease(drag.owner);
      }
      reset();
    };
    document.addEventListener("keydown", abandon, true);
    return () => {
      document.removeEventListener("keydown", abandon, true);
    };
  }, [dragging, reset, swallowClickAfterRelease]);

  return {
    ...state,
    beginInsertDrag,
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
