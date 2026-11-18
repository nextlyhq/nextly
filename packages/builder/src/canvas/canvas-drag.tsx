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
 * ## Where the parts live
 *
 * This module is the hook, `useCanvasDrag`, and the entry for the rest: the
 * shapes it hands its callers are in `canvas-drag-types.ts`, one gesture's
 * record and the questions asked of it in `canvas-drag-gesture.ts`, and the
 * drop line in `drop-indicator.tsx`. Every name it exported, it still exports.
 *
 * @module canvas-drag
 */

import { findNode } from "@nextlyhq/blocks-engine";
import * as React from "react";

import { layersLockFacts } from "../lock-refusal";
import { lockBlockingMove } from "../locking";
import type { OpPosition } from "../op-vocabulary";
import { placementTypesOf } from "../panels/add/inserter";

import {
  AUTOSCROLL_MAX_STEP_PX,
  AUTOSCROLL_ZONE_PX,
  autoscrollStep,
} from "./autoscroll";
import { nodeIdFromEvent } from "./canvas";
import {
  admitsPress,
  builtOnce,
  canvasClientPoint,
  committedTarget,
  drawnSubject,
  frameLoopOf,
  type Gesture,
  gestureOwnedBy,
  handScaleOf,
  type HeldPress,
  listenOn,
  releaseCapture,
  slotsOfNode,
  snapshotRects,
  withLockVerdict,
} from "./canvas-drag-gesture";
import {
  type CanvasDrag,
  type CanvasDragState,
  DEFAULT_ACTIVATION_PX,
  DEFAULT_SWITCH_PX,
  type DragSubject,
  type InsertDragEntry,
  type UseCanvasDragOptions,
} from "./canvas-drag-types";
import {
  inputDocuments,
  useCanvasFrame,
  type CanvasFrame,
} from "./canvas-frame-context";
import {
  collectRegions,
  movingSubtree,
  placementSources,
  resolveDrop,
} from "./drop-targets";
import {
  canvasContentPoint,
  canvasPointerPoints,
  canvasScroller,
  containerEdges,
  type CanvasPointerPoints,
} from "./geometry-dom";
import { nextTargetSwitchState, NO_TARGET } from "./target-switch";

// The public shapes, one gesture's record and the drop line live in modules of
// their own beside this hook; every name this module exported still is.
export {
  type CanvasDrag,
  type CanvasDragHandlers,
  type CanvasDragState,
  DEFAULT_ACTIVATION_PX,
  DEFAULT_SWITCH_PX,
  type DragSubject,
  type InsertDragEntry,
  type UseCanvasDragOptions,
} from "./canvas-drag-types";
export { DropIndicator, type DropIndicatorProps } from "./drop-indicator";

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
  definitions,
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
  /** A press on a block a Layers lock holds in place, if one is down. */
  const heldPress = React.useRef<HeldPress | null>(null);
  const latest = React.useRef({ editor, slots, nesting, definitions });
  latest.current = { editor, slots, nesting, definitions };

  /*
   * The document the canvas is in, read at event time like the rest. Every
   * listener a drag adds outside the canvas root goes on the documents this
   * names, because a pointer or a key inside a frame is dispatched in the
   * frame's document and never reaches the editor's.
   */
  const canvasFrame = useCanvasFrame();
  const frameRef = React.useRef<CanvasFrame>(canvasFrame);
  frameRef.current = canvasFrame;

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

  /** The document listeners a held press's drawn reason ends on, if any. */
  const detachHeld = React.useRef<(() => void) | null>(null);

  /** Forget the held press, and stop listening for its release. */
  const stopHolding = React.useCallback(() => {
    detachHeld.current?.();
    detachHeld.current = null;
    heldPress.current = null;
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
    const drag = gesture.current;
    if (drag !== null && drag.frame !== null) {
      // Cancelled on the window that scheduled it: a handle is only meaningful
      // to the clock that issued it.
      frameLoopOf(drag)?.cancelAnimationFrame(drag.frame);
    }
    gesture.current = null;
    // A palette drag listens on the document, and every way one can end arrives
    // here. So does a held press's drawn reason, which Escape abandons too.
    stopTrackingDocument();
    stopHolding();
  }, [stopTrackingDocument, stopHolding]);

  const reset = React.useCallback(() => {
    teardown();
    setState({
      draggingId: null,
      draggingBlockName: null,
      target: null,
      refusal: null,
    });
  }, [teardown]);

  /** The held press ends, and its reason with it, when its pointer lifts. */
  const releaseHeld = React.useCallback(
    (pointerId: number) => {
      const press = heldPress.current;
      if (press === null || press.owner !== pointerId) return;
      stopHolding();
      if (!press.shown) return;
      setState({
        draggingId: null,
        draggingBlockName: null,
        target: null,
        refusal: null,
      });
    },
    [stopHolding]
  );

  /**
   * Follow a held press on the documents from the moment it is recorded, as a
   * palette drag is followed: the hand may leave the canvas before or after
   * the reason is drawn, and its release there must still end the press, or a
   * later hover would draw the reason for a press long over. Escape ends it
   * through `reset`.
   */
  const holdUntilReleased = React.useCallback(() => {
    const lifted = (native: PointerEvent): void => {
      releaseHeld(native.pointerId);
    };
    const documents = inputDocuments(frameRef.current);
    const ups = listenOn(documents, "pointerup", lifted);
    const cancels = listenOn(documents, "pointercancel", lifted);
    detachHeld.current = () => {
      ups();
      cancels();
    };
  }, [releaseHeld]);

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // The primary button only. A right-click opens a context menu and a
      // middle-click scrolls, and starting a drag from either takes a gesture
      // the browser has already given a meaning.
      if (event.button !== 0) return;
      // One drag at a time, asked through the shared rule. Ignored rather than
      // cancelled, so the drag already in flight survives a stray touch, and
      // the pressed element keeps its own click because nothing here consumed
      // the press.
      if (!admitsPress(gesture.current)) return;

      const root = event.currentTarget;
      const nodeId = nodeIdFromEvent(event.target);
      if (nodeId === null) return;

      const { editor: current } = latest.current;
      const node = findNode(current.document.nodes, nodeId);
      if (node === undefined) return;

      // A block a Layers lock holds in place: locked itself, holding a locked
      // block, or inside one. The press is left alone rather than swallowed,
      // so it still selects, and is remembered so that, if the hand goes on to
      // drag, the reason is drawn over the block rather than nothing happening.
      //
      // Asked through the shared rule rather than by reading the flag here, so
      // this answers as the keyboard moves, the toolbar and Layers do.
      const held = lockBlockingMove(current.document, nodeId);
      // A held press still down ends with this one: its reason and its
      // listeners go, rather than being overwritten and left listening.
      if (heldPress.current !== null) releaseHeld(heldPress.current.owner);
      if (held !== undefined) {
        heldPress.current = {
          owner: event.pointerId,
          originClient: { x: event.clientX, y: event.clientY },
          nodeId,
          blockName: node.type,
          lock: layersLockFacts(held, nodeId, "move"),
          shown: false,
        };
        holdUntilReleased();
        return;
      }

      const rects = snapshotRects(root);
      gesture.current = {
        subject: { kind: "move", nodeId },
        owner: event.pointerId,
        origin: canvasContentPoint(event.clientX, event.clientY, root),
        originClient: { x: event.clientX, y: event.clientY },
        regions: collectRegions(
          current.document,
          latest.current.slots,
          rects,
          slotsOfNode(placementSources(latest.current))
        ),
        rects,
        forbiddenParents: movingSubtree(current.document, nodeId),
        blockName: node.type,
        blockNames: placementTypesOf(node, latest.current.definitions),
        placing: () => [node],
        placementVerdicts: new Map(),
        active: false,
        switchState: NO_TARGET,
        targets: new Map(),
        lockVerdicts: new Map(),
        root,
        scroller: canvasScroller(root, frameRef.current.frame !== null),
        handScale: handScaleOf(frameRef.current),
        clientX: event.clientX,
        clientY: event.clientY,
        frame: null,
      };
      // NOT captured here. See the activation branch in `onPointerMove`.
    },
    [releaseHeld, holdUntilReleased]
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
      const resolution = withLockVerdict(
        drag,
        latest.current.editor,
        resolveDrop(
          {
            blockNames: drag.blockNames,
            forbiddenParents: drag.forbiddenParents,
            regions: drag.regions,
            rects: drag.rects,
            nesting: latest.current.nesting,
            placement: {
              nodes: latest.current.editor.document.nodes,
              placing: drag.placing,
              sources: placementSources(latest.current),
              verdicts: drag.placementVerdicts,
            },
          },
          // CONTENT coordinates: the rects were snapshotted in that space at drag
          // start, and a scroll deliberately does not invalidate them.
          pointer.content
        )
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
    // The band and the speed are the author's pixels, carried into the canvas
    // document's by the hand scale: in a frame painted at a quarter size, the
    // 64-pixel band is 256 of the frame's pixels and the step four times as
    // many of them, so both look the same on screen at every zoom.
    const step = autoscrollStep(
      drag.clientY,
      edges.top,
      edges.bottom,
      AUTOSCROLL_ZONE_PX / drag.handScale,
      AUTOSCROLL_MAX_STEP_PX / drag.handScale
    );
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
        aim(
          drag,
          canvasPointerPoints(
            drag.clientX,
            drag.clientY,
            drag.root,
            drag.handScale
          )
        );
      }
    }
    drag.frame = frameLoopOf(drag)?.requestAnimationFrame(pump) ?? null;
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
  /**
   * A press on a held block that has travelled far enough to mean a drag: the
   * lock's reason, drawn over the block the way a refused drop is drawn over
   * the container that refused it. Once per press.
   */
  const showHeld = React.useCallback(
    (clientX: number, clientY: number, pointerId: number) => {
      const press = heldPress.current;
      if (press === null || press.owner !== pointerId || press.shown) return;
      const travelled = Math.hypot(
        clientX - press.originClient.x,
        clientY - press.originClient.y
      );
      if (travelled < activationPx) return;
      press.shown = true;
      setState({
        draggingId: null,
        draggingBlockName: press.blockName,
        target: null,
        refusal: {
          regionId: `held:${press.nodeId}`,
          parentId: press.nodeId,
          lock: press.lock,
        },
      });
    },
    [activationPx]
  );

  const trackMove = React.useCallback(
    (
      clientX: number,
      clientY: number,
      pointerId: number,
      captureHost: HTMLElement | null
    ) => {
      const drag = gestureOwnedBy(gesture.current, pointerId);
      // Null for no gesture at all, and for another finger moving anywhere:
      // neither may re-aim this one.
      if (drag === null) return;

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
      const pointer = canvasPointerPoints(
        clientX,
        clientY,
        drag.root,
        drag.handScale
      );
      // Recorded for the frame loop, which runs between moves and has no event
      // of its own to read a position from.
      drag.clientX = clientX;
      drag.clientY = clientY;

      if (!drag.active) {
        // CLIENT pixels: the threshold separates a click from an intent to
        // move, which is a property of the hand rather than of the canvas's
        // scale. Measured in content pixels it shrinks with the canvas.
        const travelled =
          Math.hypot(
            clientX - drag.originClient.x,
            clientY - drag.originClient.y
          ) * drag.handScale;
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
        drag.frame = frameLoopOf(drag)?.requestAnimationFrame(pump) ?? null;
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
      showHeld(event.clientX, event.clientY, event.pointerId);
      trackMove(
        event.clientX,
        event.clientY,
        event.pointerId,
        event.currentTarget
      );
    },
    [showHeld, trackMove]
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
        // Whether the PAGE still composes with the node there — an instance
        // carried ahead of another takes the budget that one had — is the
        // editor's own apply's to refuse, and to say why; a null here is that
        // refusal.
        current.apply({ kind: "move", id: subject.nodeId, to: at });
        return;
      }

      // From the caller's own snapshot of the palette, built once per gesture:
      // the same node the locks were asked about while the pointer aimed.
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
    let unlisten = (): void => {};
    const stop = (): void => {
      unlisten();
      detachClickSwallow.current = null;
    };
    const swallow = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    unlisten = listenOn(inputDocuments(frameRef.current), "click", swallow);
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
      const documents = inputDocuments(frameRef.current);
      let unlistenClick = (): void => {};
      let unlistenRelease = (): void => {};
      const stop = (): void => {
        unlistenClick();
        unlistenRelease();
        detachClickSwallow.current = null;
      };
      const swallow = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        stop();
      };
      const released = (event: PointerEvent): void => {
        if (event.pointerId !== pointerId) return;
        unlistenRelease();
        // The click belongs to the release's task. Given it, and no longer:
        // a suppressor left armed would eat an unrelated click later.
        setTimeout(stop, 0);
      };
      unlistenClick = listenOn(documents, "click", swallow);
      const ups = listenOn(documents, "pointerup", released);
      const cancels = listenOn(documents, "pointercancel", released);
      unlistenRelease = () => {
        ups();
        cancels();
      };
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
      // Null for another finger lifting, too: ending here would commit THIS
      // gesture's target while the finger that owns it is still down.
      const drag = gestureOwnedBy(gesture.current, pointerId);
      if (drag === null) return;
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

  /**
   * Abandon the gesture, but only for the pointer that owns it.
   *
   * A cancel is the browser withdrawing a contact — captured by something else,
   * or the touch became a scroll. That is a fact about ONE pointer, so a second
   * finger being withdrawn says nothing about the drag a first finger is still
   * performing. Resetting unconditionally would undo the gesture the press
   * guard exists to protect: a stray touch on a block, cancelled by the browser
   * a moment later, would end a palette drag the author is mid-way through.
   */
  const cancelGesture = React.useCallback(
    (pointerId: number) => {
      if (gestureOwnedBy(gesture.current, pointerId) === null) return;
      reset();
    },
    [reset]
  );

  const onPointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      releaseHeld(event.pointerId);
      endGesture(event.pointerId, event.currentTarget);
    },
    [endGesture, releaseHeld]
  );

  const beginInsertDrag = React.useCallback(
    (event: React.PointerEvent<HTMLElement>, entry: InsertDragEntry) => {
      // The primary button only, for the reason `onPointerDown` gives.
      if (event.button !== 0) return;
      // One drag at a time, asked through the shared rule. Ignored rather than
      // cancelled, so the drag already in flight survives a stray touch, and
      // the pressed element keeps its own click because nothing here consumed
      // the press.
      if (!admitsPress(gesture.current)) return;
      const root = canvasRoot?.current ?? null;
      // Nothing to drop onto. The press is left entirely alone rather than
      // half-started, so the row's click still inserts by the ordinary path.
      if (root === null) return;

      const { editor: current, slots } = latest.current;
      const rects = snapshotRects(root);
      // Built once for the gesture: the node the placement rule and the locks
      // judge while the pointer aims is the node the release inserts.
      const makeNode = builtOnce(entry.makeNode);
      // The press, in the canvas's coordinates like every later point of the
      // gesture: the row is in the editor's document, and the travel that
      // activates the drag is measured from here.
      const pressed = canvasClientPoint(
        frameRef.current,
        event.currentTarget.ownerDocument,
        event.clientX,
        event.clientY
      );
      gesture.current = {
        owner: event.pointerId,
        subject: {
          kind: "insert",
          blockName: entry.blockName,
          makeNode,
          onInserted: entry.onInserted,
        },
        origin: canvasContentPoint(pressed.x, pressed.y, root),
        originClient: pressed,
        regions: collectRegions(
          current.document,
          slots,
          rects,
          slotsOfNode(placementSources(latest.current))
        ),
        rects,
        // EMPTY, and this is the other place the kinds differ. Forbidden
        // parents exist to stop a node being dropped inside itself; nothing is
        // being detached here, so there is no subtree to exclude.
        forbiddenParents: new Set<string>(),
        blockName: entry.blockName,
        blockNames: [entry.blockName],
        // The node the palette builds, its variation's props and its seeded
        // children included, rather than the type's defaults: that node is
        // what lands. Asked for only once a region is judged, so a press that
        // never becomes a drag builds nothing.
        placing: () => {
          const made = makeNode();
          return made === null ? [] : [made];
        },
        placementVerdicts: new Map(),
        active: false,
        switchState: NO_TARGET,
        targets: new Map(),
        lockVerdicts: new Map(),
        root,
        scroller: canvasScroller(root, frameRef.current.frame !== null),
        handScale: handScaleOf(frameRef.current),
        clientX: pressed.x,
        clientY: pressed.y,
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
       * These three forward the pointer id and decide nothing.
       *
       * Ownership is enforced inside `trackMove`, `endGesture` and
       * `cancelGesture`, which is where BOTH transports converge — the canvas's
       * React handlers for a pointer over the canvas, and these listeners for
       * one anywhere else. Checking here as well would state the same rule in
       * two places, and the copy that mattered would be the one somebody forgot
       * when a third transport arrived.
       */
      /*
       * On the editor's document AND the canvas's, which are two while the
       * canvas is in a frame: a pointer over the panels is delivered to the
       * editor's and one over the page to the frame's, so a drag from a row to
       * the page is heard whole only by both. Each point is carried into the
       * canvas's coordinates by the document that delivered it.
       */
      const canvas = frameRef.current;
      const detachers = inputDocuments(canvas).map(doc => {
        const move = (native: PointerEvent): void => {
          const at = canvasClientPoint(
            canvas,
            doc,
            native.clientX,
            native.clientY
          );
          trackMove(at.x, at.y, native.pointerId, null);
        };
        const up = (native: PointerEvent): void => {
          endGesture(native.pointerId, null);
        };
        const cancel = (native: PointerEvent): void => {
          cancelGesture(native.pointerId);
        };
        const unlistenMove = listenOn([doc], "pointermove", move);
        const unlistenUp = listenOn([doc], "pointerup", up);
        const unlistenCancel = listenOn([doc], "pointercancel", cancel);
        return () => {
          unlistenMove();
          unlistenUp();
          unlistenCancel();
        };
      });
      detachDocument.current = () => {
        for (const detach of detachers) detach();
      };
    },
    [canvasRoot, cancelGesture, endGesture, trackMove]
  );

  /*
   * A drag in flight when the canvas's document is replaced — the frame
   * loading its content, or reloading — is abandoned. Its listeners are on
   * the document that went, so the release in the new one would never be
   * heard, and its root and frame loop belong to a page no longer on screen.
   */
  const gestureDocument = React.useRef(canvasFrame.document);
  React.useEffect(() => {
    if (gestureDocument.current === canvasFrame.document) return;
    gestureDocument.current = canvasFrame.document;
    const drag = gesture.current;
    if (drag === null) return;
    /*
     * A palette drag the reload cancelled still ends in a release, and if the
     * pointer has come back to the row it started on, that press and release
     * are one click — which the row inserts on. Suppressed exactly as Escape
     * suppresses it, so a drag that visibly ended adds nothing.
     */
    if (drag.active && drag.subject.kind === "insert") {
      swallowClickAfterRelease(drag.owner);
    }
    reset();
  }, [canvasFrame.document, reset, swallowClickAfterRelease]);

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
    // Every document a key can be pressed in: focus may be in a panel's
    // search field or inside the canvas's frame.
    return listenOn(inputDocuments(canvasFrame), "keydown", abandon);
  }, [dragging, reset, swallowClickAfterRelease, canvasFrame]);

  return {
    ...state,
    beginInsertDrag,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      // Routed through the same ownership check every other ending uses, so a
      // second contact being withdrawn cannot end a drag it does not own.
      onPointerCancel: event => {
        releaseHeld(event.pointerId);
        cancelGesture(event.pointerId);
      },
    },
  };
}
