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
  ownerPath,
  slot,
  index,
  empty = false,
}: {
  parentId: string;
  /**
   * Root-first ids of the owning node and its ancestors, the owner last.
   *
   * A path rather than a depth number, because a bare integer cannot answer
   * "is A an ancestor of B" — which eligibility and any nearest-legal-ancestor
   * behaviour both need — and because a depth carried alongside a path is a
   * second answer to a question the path already answers, free to drift from
   * it. The depth used below is DERIVED from the length.
   */
  ownerPath: readonly string[];
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
    data: { kind: "dropzone", parentId, ownerPath, slot, index },
    // The deeper owner wins when both claim the pointer. `@dnd-kit/collision`
    // sorts on `priority` FIRST and only falls through to geometric score when
    // priorities tie, so without this the ranking is decided entirely by area —
    // and an ancestor's target that covers a descendant's whole box beats the
    // zero-height gap zones inside it at every interior point.
    collisionPriority: ownerPath.length,
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
