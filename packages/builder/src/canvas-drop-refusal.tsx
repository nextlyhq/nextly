"use client";

/**
 * Why a dragged block can't land where it is, drawn over the container that
 * refuses it and kept in the part of the canvas the author can see.
 *
 * @module canvas-drop-refusal
 */

import { findNode, type BlockDocument } from "@nextlyhq/blocks-engine";
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import { type JSX, useRef, useState } from "react";

import { ownedNodeElement } from "./canvas-addressing";
import type { CanvasDragState } from "./canvas-drag";
import { useCanvasFrame } from "./canvas-frame-context";
import { refusalWording } from "./drag-refusal";
import {
  canvasContentRect,
  canvasScroller,
  overlaySpaceOf,
  scrollEventTarget,
  visibleBandOf,
} from "./geometry-dom";
import { lockRefusalWording } from "./lock-refusal";
import { RefusalNotice } from "./refusal-notice";
import { CANVAS_ROOT_CLASS } from "./shell-state";

/**
 * The refusal a canvas should DRAW, which is not every refusal it is given.
 *
 * `useCanvasDrag` holds the committed target across a short crossing so the
 * indicator does not flicker, while setting the refusal from the region under
 * the pointer immediately — so both are non-null for the width of the switch
 * threshold. Drawing the refusal there contradicts two things at once: the
 * line still points at the held target, and releasing commits it. The chrome
 * would say the block cannot land while letting go moves it.
 *
 * So a refusal is the honest answer only once there is no target to disagree
 * with. One function rather than the same condition written at the mark and
 * again at the message, because two spellings of one rule drift and the drift
 * shows up as chrome that half-agrees with itself.
 */
export function drawnRefusal(
  drag: CanvasDragState | undefined
): CanvasDragState["refusal"] {
  if (drag === undefined || drag.target !== null) return null;
  // A drag state built without a refusal at all reads as none.
  return drag.refusal ?? null;
}

/**
 * The sentence a refused drop draws, over the container that refused it.
 *
 * Anchored to the CONTAINER rather than to the pointer. The drag state carries
 * no pointer coordinate — reading one back would mean a second answer to a
 * question `useCanvasDrag` already owns — and a message pinned to the region is
 * steadier to read than one that moves with the hand.
 *
 * Measured in the canvas's own CONTENT coordinates, the space the drop
 * indicator and the block toolbar are already positioned in, so the three agree
 * at any scroll offset and under zoom.
 *
 * Keyed on the region and the reason rather than on the refusal OBJECT: the
 * drag hook returns a fresh object every pointer move, and re-measuring per
 * frame would cost a layout read for an answer that changes only when the
 * pointer crosses into a different container.
 */
function DropRefusalNotice({
  refusal,
  movingType,
  regionType,
}: {
  refusal: NonNullable<CanvasDragState["refusal"]>;
  movingType: string;
  regionType: string | undefined;
}): React.JSX.Element {
  const notice = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // Whether the canvas is in the editor's frame, whose viewport scrolls it,
  // and the zoom, which moves the region on screen while nothing in the frame
  // changes.
  const canvasFrame = useCanvasFrame();
  const framed = canvasFrame.frame !== null;
  const { parentId } = refusal;
  // One wording per rule: a lock's from the function every lock refusal uses,
  // a nesting refusal's from the drag's own.
  const { headline, remedy } =
    "lock" in refusal
      ? lockRefusalWording(refusal.lock)
      : refusalWording(refusal, movingType, regionType);

  /*
   * Measured BEFORE the browser paints, not after.
   *
   * A plain effect runs after paint, so the message draws once at the canvas's
   * top-left — where an unpositioned absolute box lands — and jumps to the
   * container on the next frame. During a drag that is not a single flash: a
   * refusal is re-entered every time the pointer crosses into a region that
   * will not take the block, so the jump repeats.
   *
   * The isomorphic form rather than `useLayoutEffect` directly, because a
   * client component is still server-rendered and the plain hook warns there.
   */
  useIsomorphicLayoutEffect(() => {
    const element = notice.current;
    if (element === null) return;
    /*
     * The canvas the notice is drawn over and the space it is drawn in: inside
     * the root over a canvas sharing the editor's document, or in the layer
     * over the canvas's frame, where the root's coordinates are scaled to the
     * zoom and the notice keeps its own size. The clamp below is worked out in
     * the root's coordinates and only the result is placed.
     */
    const space = overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) return;
    const { root } = space;
    const scroller = canvasScroller(root, framed);
    const place = (point: { x: number; y: number }): void => {
      const placed = space.place({ ...point, width: 0, height: 0 });
      setAt({ x: placed.x, y: placed.y });
    };
    const measure = (): void => {
      // The root itself when the refusal is at the page level: there is no
      // container node to point at, which is the whole of what
      // `restricted-at-root` means.
      /*
       * Resolved within THIS canvas, for the reason the marks are: a node id is
       * unique in a document and not across documents, so a block rendering a
       * second canvas can put a matching id earlier in the tree — and the message
       * would then be anchored over a block belonging to another document.
       */
      const region =
        parentId === undefined ? root : ownedNodeElement(root, parentId);
      if (region === null) return;
      const rect = canvasContentRect(region, root);

      /*
       * Clamped into the part of the canvas the author can actually see.
       *
       * The anchor alone is not enough. A root refusal has no container to point
       * at, so it resolves to the canvas itself and lands at the page origin —
       * which on a long page is several screens above someone dragging near the
       * bottom, so the explanation for what just refused them is drawn where they
       * are not looking. A very tall container scrolled past does the same.
       *
       * The scroller defines "visible": the shell scrolls an ancestor rather than
       * the canvas, and in a frame of its own the frame's viewport scrolls it.
       * The same scroller this effect listens to below, so what is measured
       * and what is heard cannot be two different elements, and its visible
       * part measured in this canvas's own content coordinates is exactly the
       * band on screen.
       */
      if (scroller === null) {
        place({ x: rect.x, y: rect.y });
        return;
      }
      const band = visibleBandOf(scroller, root);
      const inset = 12;
      // The notice's height in the root's coordinates: drawn at its own size
      // over a frame painted at another.
      const height = space.sizeOf(element).height / space.scale;
      const lowest = band.y + band.height - inset - height;
      const top = band.y + inset;
      // A band shorter than the message puts `lowest` above its own top, which
      // makes the range inverted rather than narrow. Taking the top there keeps
      // the message on screen instead of pinning it to a bound derived from a
      // height that does not fit.
      place({
        x: rect.x,
        y: lowest < top ? top : Math.max(top, Math.min(rect.y, lowest)),
      });
    };

    measure();

    /*
     * Re-measured while the canvas scrolls under a stationary pointer.
     *
     * Autoscroll is the case that makes this necessary rather than tidy: a drag
     * held near an edge keeps scrolling without the pointer moving, so the
     * refusal does not change and nothing in this effect's inputs does either —
     * while the band the message was clamped into travels away from it. The
     * explanation would sit still and the page would leave.
     *
     * Passive, because this only reads geometry, and on the SCROLLER rather
     * than the canvas: the canvas does not scroll, its ancestor does — or, in
     * a frame of its own, the frame's viewport, whose scroll is dispatched at
     * the frame's document rather than at any element.
     */
    if (scroller === null) return;
    const source = scrollEventTarget(scroller);
    source.addEventListener("scroll", measure, { passive: true });
    return () => {
      source.removeEventListener("scroll", measure);
    };
    /*
     * Re-measured when the WORDING changes, not merely when the container does.
     *
     * Two slots on one container share a `parentId` and a reason while carrying
     * different permitted lists, so the message can be replaced without any of
     * the identity this effect anchors on moving. A longer remedy wraps onto
     * another line, and the clamp would still be holding the height of the
     * sentence it replaced — which is exactly the case that pushes it back out
     * of the band near the bottom of the viewport.
     *
     * Keyed on the rendered strings rather than on `regionId`, because height
     * is a property of the text: two regions producing identical sentences need
     * no re-measure, and one region whose list changed does.
     */
  }, [parentId, headline, remedy, framed, canvasFrame]);

  return (
    <RefusalNotice
      ref={notice}
      className="nx-drop-refusal"
      style={at === null ? undefined : { left: at.x, top: at.y }}
      /*
       * NOT announced, matching {@link DropIndicator} rather than differing
       * from it: this describes a POINTER gesture, and a live region here
       * would speak to someone who is not the one dragging. The spoken
       * counterpart is `keyboard-actions`, which refuses a move the nesting
       * rule forbids and announces the same reason and remedy through its own
       * live region, asked of the same wording function.
       */
      headline={headline}
      remedy={remedy}
    />
  );
}

/**
 * Why the block being dragged cannot land where it is, drawn over the
 * container that refused it, or nothing while there is no refusal to draw.
 *
 * Chrome like the drop line, so it goes where the chrome goes: the overlay of
 * the `CanvasFrame` the canvas is drawn in, in the editor's document, or the
 * canvas's own `overlay` over a canvas sharing that document.
 *
 * @experimental
 */
export function DropRefusal({
  drag,
  document,
}: {
  /** What the pointer means, from `useCanvasDrag`, as the canvas is given it. */
  drag: CanvasDragState | undefined;
  /** The document the canvas is drawing, which names the refusing block. */
  document: BlockDocument;
}): JSX.Element | null {
  const refusal = drawnRefusal(drag);
  if (refusal === null) return null;
  const { parentId } = refusal;
  return (
    <DropRefusalNotice
      refusal={refusal}
      movingType={drag?.draggingBlockName ?? ""}
      /*
       * The container's TYPE, resolved from the document the canvas is
       * drawing. The refusal names the node; what an author reads is the
       * block's name, and the document is the only place that mapping exists.
       */
      regionType={
        parentId === undefined
          ? undefined
          : findNode(document.nodes, parentId)?.type
      }
    />
  );
}
