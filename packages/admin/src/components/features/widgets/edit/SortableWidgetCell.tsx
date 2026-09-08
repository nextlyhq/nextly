"use client";

/**
 * One grid cell, draggable while the reader is editing.
 *
 * A component rather than a branch inside the grid's map, because `useSortable`
 * is a hook and a hook cannot be called from a loop body. That constraint is
 * also the right shape: the cell owns its own drag state, and the grid stays a
 * list of cells.
 *
 * ## Drag is the SECOND way to move a card, never the only one
 *
 * The Move up / Move down buttons in `WidgetEditControls` are what satisfy
 * WCAG 2.2 SC 2.5.7, which requires a single-pointer alternative to every
 * dragging movement. This handle is the affordance most people reach for
 * first; it is not the one that makes the feature usable. If the two ever
 * disagree, the buttons are correct.
 *
 * The handle carries the drag listeners rather than the whole cell, so a reader
 * can still select text in a card, click a link inside it, and press the
 * controls above it while editing.
 *
 * @module components/features/widgets/edit/SortableWidgetCell
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

export interface SortableWidgetCellProps {
  id: string;
  /** What the reader calls this card, so the handle can name what it moves. */
  title: string;
  isEditing: boolean;
  className?: string;
  "data-testid"?: string;
  children: ReactNode;
}

export function SortableWidgetCell({
  id,
  title,
  isEditing,
  className,
  "data-testid": testId,
  children,
}: SortableWidgetCellProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !isEditing });

  return (
    <div
      ref={setNodeRef}
      data-testid={testId}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        className,
        // Lifted while dragging so it reads as picked up rather than as a hole
        // in the grid. `relative` because a transformed cell with no stacking
        // context slides UNDER its neighbours.
        isDragging && "relative z-10 opacity-80"
      )}
    >
      {isEditing ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          // `cursor-grab`, not `cursor-move`: this reorders within a list, it
          // does not move the card to an arbitrary point.
          // 🔴 LEFT, not right. On the right it overlapped `WidgetEditControls`'
          // Remove button — same corner, higher `z-index` — so the handle
          // swallowed pointer input across most of a control the feature
          // promises is ordinarily clickable. The toolbar's own content starts
          // with a title that has room to spare, so the handle sits before it
          // and the buttons keep the right edge to themselves.
          className="absolute left-1 top-1 z-10 cursor-grab rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          // Names the card, because a grid of identical handles is unusable
          // otherwise. dnd-kit supplies its own keyboard instructions through
          // `attributes`; this is the label they attach to.
          aria-label={`Drag to reorder ${title}`}
          data-testid="widget-drag-handle"
        >
          <Icons.GripVertical aria-hidden className="size-4" />
        </button>
      ) : null}
      {children}
    </div>
  );
}
