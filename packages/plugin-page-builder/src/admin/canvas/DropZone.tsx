"use client";

/**
 * A drop target between (or inside) a slot's children (spec §9). Each gap is its own
 * droppable, so the editor shows EXACTLY where a block will land: the targeted zone
 * lights up with a blue insertion line, and an empty container shows a "Drop here"
 * placeholder. Zones only claim space while a drag is in progress, so the canvas stays
 * clean at rest.
 */
import { useDragDropMonitor, useDroppable } from "@dnd-kit/react";
import { useState, type ReactNode } from "react";

const BLOCK_TYPE = "nx-block";

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

  return (
    <div
      ref={ref}
      className="nx-pb-dropzone"
      data-drag={dragging || undefined}
      data-active={isDropTarget || undefined}
    />
  );
}
