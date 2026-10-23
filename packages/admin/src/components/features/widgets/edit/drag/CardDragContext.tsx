"use client";

/**
 * The drag library's context around the dashboard's cards, and the chip a pointer drag holds.
 *
 * Its own component so the grid states only that its cards can be dragged: which sensors run,
 * what is announced and what follows the pointer are the drag's business (`useCardDrag`).
 *
 * @module components/features/widgets/edit/drag/CardDragContext
 */

import { DndContext, DragOverlay } from "@dnd-kit/core";
import type { JSX, ReactNode } from "react";

import * as Icons from "@admin/components/icons";

import {
  chipAtPointer,
  DRAG_SCREEN_READER,
  SILENT_DRAG,
  type CardDrag,
} from "./useCardDrag";

/** The chip modifier, made once: a new array each render would reset the overlay. */
const CHIP_MODIFIERS = [chipAtPointer];

/** What a pointer drag holds: the card's name, beside the pointer. */
function DragChip({ title }: { title: string }) {
  return (
    <div
      data-testid="widget-drag-chip"
      className="inline-flex max-w-xs items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-1.5 text-sm font-medium text-popover-foreground shadow-md"
    >
      <Icons.GripVertical
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="truncate">{title}</span>
    </div>
  );
}

export function CardDragContext({
  drag,
  children,
}: {
  drag: CardDrag;
  children: ReactNode;
}): JSX.Element {
  const held = drag.drag;
  return (
    <DndContext
      // The same sensors at every width. dnd-kit reads the list as an effect's dependencies, so
      // a list that empties at one column changes size between renders, which React warns of
      // and does not promise to handle. A drag cannot start there anyway: the grid hands a card
      // no drag while dragging is off, so its `useDraggable` is disabled and no handle is drawn.
      sensors={drag.sensors}
      onDragStart={drag.onDragStart}
      onDragMove={drag.onDragMove}
      onDragEnd={drag.onDragEnd}
      onDragCancel={drag.onDragCancel}
      accessibility={{
        announcements: SILENT_DRAG,
        screenReaderInstructions: DRAG_SCREEN_READER,
      }}
    >
      {children}
      {/* No drop animation: the card is put down where the line was, not flown back to it. */}
      <DragOverlay modifiers={CHIP_MODIFIERS} dropAnimation={null}>
        {held?.by === "pointer" ? <DragChip title={held.title} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
