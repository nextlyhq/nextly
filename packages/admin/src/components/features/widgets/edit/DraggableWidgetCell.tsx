"use client";

/**
 * One grid cell, draggable by its handle while the reader is customising.
 *
 * A component rather than a branch inside the grid's map, because `useDraggable`
 * is a hook and a hook cannot be called from a loop body. That constraint is
 * also the right shape: the cell owns its own drag wiring, and the grid stays a
 * list of cells.
 *
 * ## Drag is the SECOND way to move a card, never the only one
 *
 * The moves in each card's menu (`CardActionsMenu`) are what satisfy WCAG 2.2
 * SC 2.5.7, which requires a single-pointer alternative to every dragging
 * movement. They work at every width; this handle is drawn only where dragging
 * is on, which is wherever the dashboard shows more than one column.
 *
 * ## Nothing moves while dragging
 *
 * 🔴 Cards are different widths. Sliding the others aside as one is dragged,
 * as a sortable list does, reshuffles the rows under the pointer, so the place
 * it is over moves away from it. So no card moves: the held one dims where it
 * is, a chip with its name follows the pointer, and a line shows where it will
 * land (`useCardDrag`). The order changes once, on release.
 *
 * The handle carries the drag rather than the whole cell, so the card's other
 * controls, its menu among them, stay pressable while customising. The card's
 * own links and controls are out of reach then (`CustomizingFence`):
 * customising is about the arrangement.
 *
 * @module components/features/widgets/edit/DraggableWidgetCell
 */

import { useDraggable } from "@dnd-kit/core";
import {
  useCallback,
  type KeyboardEvent,
  type ReactNode,
  type JSX,
} from "react";

import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { handleLabel } from "./drag/drag-messages";
import { CELL_PLACEMENT_ATTRIBUTE } from "./drag/useCardDrag";

/** What the cell's handle does, while dragging is on. */
export interface CellDrag {
  /** The card is the one being dragged: drawn dimmed where it is. */
  held: boolean;
  onKeyDown: (event: KeyboardEvent) => void;
  onBlur: () => void;
  /** Files the handle as this card's focus target. */
  handleRef: (element: HTMLElement | null) => void;
}

export interface DraggableWidgetCellProps {
  id: string;
  /** What the reader calls this card, so the handle can name what it moves. */
  title: string;
  isEditing: boolean;
  /**
   * The drag, while it is on. Absent at one column, where the handle is not drawn at all and
   * the card menu moves the card.
   */
  drag?: CellDrag;
  /** The card just placed (moved, resized, added or put back): ringed so the reader sees it. */
  highlighted?: boolean;
  className?: string;
  "data-testid"?: string;
  children: ReactNode;
}

export function DraggableWidgetCell({
  id,
  title,
  isEditing,
  drag,
  highlighted = false,
  className,
  "data-testid": testId,
  children,
}: DraggableWidgetCellProps): JSX.Element {
  const draggable = isEditing && drag !== undefined;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } =
    useDraggable({ id, disabled: !draggable });

  // One element, two registrations: dnd-kit's activator, and the dashboard's focus target.
  const handleRef = drag?.handleRef;
  const setHandle = useCallback(
    (element: HTMLElement | null) => {
      setActivatorNodeRef(element);
      handleRef?.(element);
    },
    [setActivatorNodeRef, handleRef]
  );

  return (
    <div
      ref={setNodeRef}
      data-testid={testId}
      {...{ [CELL_PLACEMENT_ATTRIBUTE]: id }}
      data-highlighted={highlighted || undefined}
      data-held={drag?.held || undefined}
      className={cn(
        className,
        // Ringed in the primary colour, offset from the card so it reads in both schemes. It
        // fades in only where motion is welcome; with reduced motion it simply appears.
        highlighted &&
          "rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300",
        // The held card stays in place, dimmed, so the line is the only thing that says where
        // it is going.
        drag?.held && "opacity-50"
      )}
    >
      {draggable ? (
        <button
          type="button"
          ref={setHandle}
          {...attributes}
          {...listeners}
          onKeyDown={drag.onKeyDown}
          onBlur={drag.onBlur}
          // `cursor-grab`, not `cursor-move`: this reorders within a list, it
          // does not move the card to an arbitrary point.
          // 🔴 LEFT, not right. The right end of a card's header holds its
          // width and its menu, and a handle there at a higher `z-index`
          // swallowed pointer input meant for them.
          // `touch-none` on the handle alone: a finger on it drags, a finger anywhere else on
          // the page still scrolls it.
          className="absolute left-1 top-1 z-10 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          // Names the card, because a grid of identical handles is unusable
          // otherwise. The keys are read from dnd-kit's instructions, which
          // `attributes` points at.
          aria-label={handleLabel(title)}
          data-testid="widget-drag-handle"
        >
          <Icons.GripVertical aria-hidden className="size-4" />
        </button>
      ) : null}
      {children}
    </div>
  );
}
