"use client";
/**
 * The dashboard's columns, and everything drawn inside them.
 *
 * Lifted out of `WidgetGrid` so that the grid reads as what it orchestrates --
 * permissions, the arrangement, the batch, the drag context -- rather than as
 * those plus a nested render. The tracks, the live region and the per-card
 * wiring are one concern and they live together here.
 *
 * @module components/features/widgets/edit/ArrangedColumns
 */
import { cn } from "@admin/lib/utils";
import type { WidgetSlot } from "@admin/types/dashboard/widgets";

import { COLUMN_TRACK_CLASSES } from "../sizes";

import { ArrangedCell } from "./ArrangedCell";
import type { ArrangedWidget } from "./useDashboardArrangement";
import { WidgetColumn } from "./WidgetColumn";

export interface ArrangedColumnsProps {
  columns: ArrangedWidget[][];
  columnCount: number;
  /** The same cards as one sequence, which the per-card controls count from. */
  visible: ArrangedWidget[];
  isEditing: boolean;
  slots: Record<string, WidgetSlot>;
  requested: ReadonlySet<string>;
  updatedAt: Date | null;
  isFetching: boolean;
  announcement: string;
  onMove: (index: number, delta: number) => void;
  onMoveColumn: (placementId: string, delta: number) => void;
  onToggleHidden: (placementId: string) => void;
  onRemove: (placementId: string) => void;
}

function EmptyArrangement({
  count,
  isEditing,
}: {
  count: number;
  isEditing: boolean;
}) {
  if (count > 0) return null;
  return (
    <p
      data-testid="widget-grid-empty"
      className="col-span-12 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground"
    >
      {isEditing
        ? "Every card is put away. Add one back below, or reset to the default arrangement."
        : "Your dashboard has no cards on it. Edit it to bring one back, or reset to the default arrangement."}
    </p>
  );
}

export function ArrangedColumns({
  columns,
  columnCount,
  visible,
  isEditing,
  slots,
  requested,
  updatedAt,
  isFetching,
  announcement,
  onMove,
  onMoveColumn,
  onToggleHidden,
  onRemove,
}: ArrangedColumnsProps) {
  return (
    <section
      aria-label="Dashboard widgets"
      // One track per column, each an independent vertical list. Nothing
      // spans tracks, so a card's width never depends on its neighbours --
      // which is the property the previous twelve-column grid lacked and
      // the reason dragging one resized it.
      className={cn("grid gap-6", COLUMN_TRACK_CLASSES[columnCount] ?? "")}
    >
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="widget-grid-live"
      >
        {announcement}
      </span>
      <EmptyArrangement count={visible.length} isEditing={isEditing} />
      {columns.map((rowsInColumn, columnIndex) => (
        <WidgetColumn
          key={columnIndex}
          column={columnIndex}
          items={rowsInColumn.map(row => row.placementId)}
          isEditing={isEditing}
        >
          {rowsInColumn.map(row => (
            <ArrangedCell
              key={row.placementId}
              row={row}
              index={visible.indexOf(row)}
              count={visible.length}
              isEditing={isEditing}
              slot={slots[row.widget.id]}
              // Only a widget that actually ASKED can be waiting on an answer. A
              // card drawn entirely by a plugin component took no part in the
              // batch, and neither did one whose archetype nothing can draw, so a
              // refetch says nothing about either.
              updatedAt={requested.has(row.widget.id) ? updatedAt : null}
              isFetching={requested.has(row.widget.id) ? isFetching : false}
              // The arrangement hook announces, because it is the one that
              // resolves the destination -- announcing here would name a
              // position computed a second time, and the two would drift.
              onMove={onMove}
              columnCount={columnCount}
              onMoveColumn={onMoveColumn}
              onToggleHidden={onToggleHidden}
              onRemove={onRemove}
            />
          ))}
        </WidgetColumn>
      ))}
    </section>
  );
}
