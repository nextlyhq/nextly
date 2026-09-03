"use client";
/**
 * One column of the dashboard, and the drop target it has to be.
 *
 * ## Why a column is its own sortable context
 *
 * 🔴 A card's width no longer depends on its neighbours. On the wrapped grid
 * this replaced, cards took uneven fractions of twelve, so dragging one past a
 * wider one reflowed the row and the sorting strategy — which predicts
 * positions from measured rectangles — mispredicted, and the cards visibly
 * resized mid-gesture. dnd-kit's own tracker describes that as variable sized
 * sortables being stretched when dragged.
 *
 * A column is a single list of equal-width items, which is the case
 * `verticalListSortingStrategy` is built for, and it supports items of varying
 * HEIGHT — the one dimension a dashboard card genuinely varies in.
 *
 * ## Why the column is droppable as well as its cards
 *
 * An empty column holds no card to aim at. Without a drop target of its own it
 * is reachable only until its last card leaves, and never again — a reader
 * could empty column three and have no way to put anything back.
 *
 * @module components/features/widgets/edit/WidgetColumn
 */
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ReactNode } from "react";

import { cn } from "@admin/lib/utils";

import { columnDropId } from "../layout-editor";

export interface WidgetColumnProps {
  column: number;
  /** The placement ids in this column, in the order they are drawn. */
  items: string[];
  isEditing: boolean;
  children: ReactNode;
}

export function WidgetColumn({
  column,
  items,
  isEditing,
  children,
}: WidgetColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(column) });

  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-w-0 flex-col gap-6",
          // A column with nothing in it still has to be AIMED AT, so while
          // editing it keeps a minimum height and shows where a card would
          // land. Outside editing it collapses, because an empty column is
          // then just absent space rather than a target.
          isEditing && "min-h-24 rounded-lg border border-dashed p-2",
          isEditing && isOver && "border-primary bg-primary/5",
          isEditing && !isOver && "border-border/60"
        )}
        data-testid={`widget-column-${column}`}
      >
        {children}
      </div>
    </SortableContext>
  );
}
