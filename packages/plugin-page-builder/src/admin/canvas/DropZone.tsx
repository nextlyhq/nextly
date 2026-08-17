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

const BLOCK_TYPE = "nx-block";

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
 *
 * EVERY droppable on the canvas must carry a priority from this scale, not just
 * the zones here. A droppable that omits `collisionPriority` keeps whatever the
 * detector assigned — `High` (3) when the pointer is inside it, `Normal` (2)
 * otherwise — and since priority is compared before everything else, such a
 * target outranks any zone shallower than that number however the rectangles
 * lie. The two scales are not comparable, so an unset priority is not a neutral
 * default: it is a constant that wins the first three levels of the tree.
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

/**
 * Above every priority the collision detector assigns on its own.
 *
 * `collisionPriority` OVERRIDES the detector's value rather than supplying one
 * where none exists — `@dnd-kit/abstract` applies it after the detector has
 * already decided — and the detector's own scale is `High` (3) when the pointer
 * is inside the element and `Normal` (2) otherwise. Depths counted from zero
 * therefore share numbers with it, so a droppable that MISSED its priority
 * would tie with, or beat, a correctly ranked one, and which happened would
 * depend on how deeply the document happened to nest.
 *
 * Basing the canvas scale above that range makes the two kinds
 * non-overlapping: an omission then loses to every ranked droppable at any
 * depth, which is a loud and constant failure rather than a plausible one.
 */
const CANVAS_PRIORITY_BASE = 10;

/**
 * The collision priority for a droppable at `depth`.
 *
 * Every droppable the canvas registers takes its priority from HERE. The
 * numbers are only comparable if one place produces them: two scales in one
 * canvas make "which target claims the pointer" depend on nesting depth, which
 * is not a question anyone means to ask.
 */
export function canvasPriority(depth: number): number {
  return CANVAS_PRIORITY_BASE + depth;
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
    collisionPriority: canvasPriority(depth),
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
