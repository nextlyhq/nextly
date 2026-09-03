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
 * ## Why the droppable sits BELOW the cards rather than around them
 *
 * A column's own empty space belongs to no card, and collision detection
 * resolves a release there to whichever card is geometrically nearest — which,
 * when the neighbouring column is longer, is a card in a DIFFERENT column. So a
 * release under a short column's last card moved the card sideways instead of
 * appending to the column it was released over.
 *
 * Wrapping the whole column in a droppable fixes that and creates the opposite
 * fault: the container's rectangle covers the cards too, so a release aimed at
 * a position between two of them can resolve to the container instead, and the
 * position the reader aimed at is lost.
 *
 * A zone occupying only the space the cards do not is both. It cannot compete
 * with a card, because it never overlaps one; and it covers exactly the region
 * whose nearest card is in the wrong column. It grows to fill whatever is left,
 * so a short column's target is as large as its empty space.
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

import { columnDropId, type ColumnDropData } from "../layout-editor";

export interface WidgetColumnProps {
  column: number;
  /** How many columns the dashboard has, so this one can say which it is. */
  columnCount: number;
  /** The placement ids in this column, in the order they are drawn. */
  items: string[];
  isEditing: boolean;
  children: ReactNode;
}

export function WidgetColumn({
  column,
  columnCount,
  items,
  isEditing,
  children,
}: WidgetColumnProps) {
  // 🔴 The id is NUMERIC, which is what keeps it disjoint: dnd-kit keys its
  // registry by id alone, so a string shared with a placement would make one
  // registration replace the other before any metadata could be read. The
  // `data` then says which column this is, without anything having to
  // interpret the id.
  //
  // Registered only while editing. Outside it there is no zone to attach the
  // ref to, and a droppable with no element has no rectangle to collide with.
  const { setNodeRef, isOver } = useDroppable({
    id: columnDropId(column),
    disabled: !isEditing,
    data: { widgetColumn: column } satisfies ColumnDropData,
  });

  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      <div
        // Named as a group so a reader moving through the dashboard is told
        // when they cross a column boundary. The cards say which column they
        // are in visually; without this the same fact is available to a screen
        // reader only from the move announcement, which a reader browsing
        // rather than rearranging never hears.
        role="group"
        aria-label={`Column ${column + 1} of ${columnCount}`}
        className="flex min-w-0 flex-col gap-6"
        data-testid={`widget-column-${column}`}
      >
        {children}
        {isEditing && (
          <div
            ref={setNodeRef}
            data-testid={`widget-column-drop-${column}`}
            className={cn(
              // Grows into whatever the cards leave, so the target is the whole
              // of this column's empty space rather than a strip inside it. The
              // grid stretches every column to the tallest, so a short column
              // has space to fill and the tallest keeps its stated minimum.
              "flex-1 rounded-lg border border-dashed",
              items.length === 0 ? "min-h-24" : "min-h-12",
              // 🔴 The border token at FULL strength, never an alpha-faded one.
              // This outline says where a card may be dropped, so it carries
              // information rather than decorating, and non-text contrast has
              // to reach 3:1 — a sixty-percent alpha measures 1.13:1 on the
              // page surface and the contrast suite refuses it.
              //
              // The faded variant is described here rather than written out:
              // that suite and Tailwind's scanner both read this file as TEXT,
              // so spelling the class in prose registers it as a usage and
              // fails the check the comment exists to explain.
              isOver ? "border-primary bg-primary/5" : "border-border"
            )}
          />
        )}
      </div>
    </SortableContext>
  );
}
