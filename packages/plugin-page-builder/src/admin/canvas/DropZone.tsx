"use client";

/**
 * A drop target between (or inside) a slot's children (spec §9). Each gap is its own
 * droppable, so the editor shows EXACTLY where a block will land: the targeted zone
 * lights up with a blue insertion line, and an empty container shows a "Drop here"
 * placeholder. Zones only claim space while a drag is in progress, so the canvas stays
 * clean at rest.
 *
 * A zone occupies no layout space at any point, including mid-drag: the target
 * the pointer is tested against is taken out of flow, so it has a real
 * rectangle while contributing nothing to the document's geometry.
 */
import { useDragDropMonitor, useDroppable } from "@dnd-kit/react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { createZoneCollisionDetector } from "./zoneCollision";

const BLOCK_TYPE = "nx-block";

/**
 * Shared by every interleaved zone, and built once at module scope because it
 * closes over nothing per-zone: the detector reads the incumbent target from
 * the drag operation it is handed, so there is no state to keep and no reason
 * to give each zone its own instance.
 */
const zoneCollisionDetector = createZoneCollisionDetector();

/**
 * How deeply nested the container owning these zones is.
 *
 * Read by every zone as its collision priority, so "the innermost container
 * owns the drop target" is decided by the tree rather than by which rectangle
 * happens to score better. Two containers can mark the SAME insertion point at
 * the same y — a nested container's first gap sits exactly where its parent's
 * gap between children sits — and out of flow those rectangles are identical,
 * which leaves a geometric detector nothing to choose by.
 *
 * A context rather than a prop because the tree recurses through each block's
 * own `render`, which receives finished slot elements: there is no single call
 * path to thread a depth argument along.
 */
const CanvasDepthContext = createContext(0);

/** Wrap a container's slot content so its zones rank below the ones inside it. */
export function CanvasDepth({
  depth,
  children,
}: {
  depth: number;
  children: ReactNode;
}): ReactNode {
  return (
    <CanvasDepthContext.Provider value={depth}>
      {children}
    </CanvasDepthContext.Provider>
  );
}

/** The depth the surrounding container renders its children at. */
export function useCanvasDepth(): number {
  return useContext(CanvasDepthContext);
}

export function DropZone({
  parentId,
  slot,
  index,
  empty = false,
}: {
  parentId: string;
  slot: string;
  index: number;
  empty?: boolean;
}): ReactNode {
  const depth = useCanvasDepth();
  const [dragging, setDragging] = useState(false);
  useDragDropMonitor({
    onDragStart() {
      setDragging(true);
    },
    onDragEnd() {
      setDragging(false);
    },
  });

  const { ref, isDropTarget } = useDroppable({
    id: `dz:${parentId}:${slot}:${index}`,
    type: BLOCK_TYPE,
    accept: BLOCK_TYPE,
    data: { kind: "dropzone", parentId, slot, index },
    // Depth decides which container claims the pointer, and it outranks
    // geometry: `sortCollisions` compares priority before collision type and
    // before overlap, so the deepest container that collides at all wins. That
    // is what "the innermost container owns the drop target" asks for, and it
    // is the only thing that can settle two IDENTICAL rectangles — which is
    // exactly what a nested container's edge gap and its parent's gap are.
    collisionPriority: depth,
    // Only the interleaved zones rank this way. They are the ones that compete
    // with a sibling zone for the same pointer, so they are the ones a switch
    // margin means anything for; a container's single "drop here" zone has no
    // sibling to flip to, and keeps the default ranking.
    collisionDetector: empty ? undefined : zoneCollisionDetector,
  });

  if (empty) {
    return (
      <div
        ref={ref}
        className="nx-pb-dropzone-empty"
        data-active={isDropTarget || undefined}
      >
        Drop a block here
      </div>
    );
  }

  // Two elements, because they answer different questions. The slot holds the
  // zone's place in the document and is zero-height for its whole life, so a
  // drag starting never reflows anything. The inner element is the DROPPABLE —
  // dnd-kit measures the node it is given a ref to — and is out of flow, so it
  // occupies the gap it marks without contributing to layout.
  return (
    <div className="nx-pb-dropzone-slot">
      <div
        ref={ref}
        className="nx-pb-dropzone"
        data-drag={dragging || undefined}
        data-active={isDropTarget || undefined}
      />
    </div>
  );
}
