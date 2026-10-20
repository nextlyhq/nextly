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
 * The moves in each card's menu (`CardActionsMenu`) are what satisfy WCAG 2.2
 * SC 2.5.7, which requires a single-pointer alternative to every dragging
 * movement. This handle is the affordance most people reach for first; it is
 * not the one that makes the feature usable.
 *
 * ## Only the dragged card moves while dragging
 *
 * 🔴 Cards are different widths, and dnd-kit's sorting strategies preview a
 * reorder by sliding each card into the rectangle its neighbour held, scaled
 * to fit. With a quarter beside a full card that stretches one into the
 * other's shape and draws a row the grid would never lay out. So the cards the
 * reader is not holding stay where they are, the held card follows the
 * pointer unscaled, and the list reorders once, on drop.
 *
 * The handle carries the drag listeners rather than the whole cell, so the
 * card's other controls -- its width and its menu -- stay pressable while
 * editing. The card's own links and controls are out of reach then
 * (`CustomizingFence`): customising is about the arrangement.
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
  /** The card just added from the add panel: ringed so the reader sees where it landed. */
  highlighted?: boolean;
  className?: string;
  "data-testid"?: string;
  children: ReactNode;
}

export function SortableWidgetCell({
  id,
  title,
  isEditing,
  highlighted = false,
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

  // The held card's own offset, translated only: a scale would stretch it to
  // the shape of whichever card it is over. Every other card stays put.
  const style = isDragging
    ? { transform: CSS.Translate.toString(transform), transition }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      data-testid={testId}
      data-highlighted={highlighted || undefined}
      style={style}
      className={cn(
        className,
        // Ringed in the focus colour, offset from the card so it reads in both schemes.
        highlighted &&
          "rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background",
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
          // 🔴 LEFT, not right. The right end of a card's header holds its
          // width and its menu, and a handle there at a higher `z-index`
          // swallowed pointer input meant for them.
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
