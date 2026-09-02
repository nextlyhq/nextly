"use client";

/**
 * One cell of the grid: its width, its spacing, its edit controls and the
 * widget inside it.
 *
 * Its own component because the grid was carrying every one of these decisions
 * inline and the complexity gate objected before a reader would have. The split
 * is by SUBJECT rather than by size: everything here is about one card, and
 * everything left in the grid is about the set.
 *
 * @module components/features/widgets/edit/ArrangedCell
 */

import { cn } from "@admin/lib/utils";
import type { WidgetSlot } from "@admin/types/dashboard/widgets";

import { moveAffordance } from "../layout-editor";
import { widgetSpanClass } from "../sizes";
import { WidgetRenderer } from "../WidgetRenderer";

import { SortableWidgetCell } from "./SortableWidgetCell";
import type { ArrangedWidget } from "./useDashboardArrangement";
import { WidgetEditControls } from "./WidgetEditControls";

export interface ArrangedCellProps {
  row: ArrangedWidget;
  index: number;
  count: number;
  isEditing: boolean;
  slot: WidgetSlot | undefined;
  /** `null` when this card took no part in the batch. */
  updatedAt: Date | null;
  isFetching: boolean;
  onMove: (index: number, delta: number) => void;
  onToggleHidden: (placementId: string) => void;
  onRemove: (placementId: string) => void;
}

export function ArrangedCell({
  row,
  index,
  count,
  isEditing,
  slot,
  updatedAt,
  isFetching,
  onMove,
  onToggleHidden,
  onRemove,
}: ArrangedCellProps) {
  const widget = row.widget;
  const { canMoveUp, canMoveDown } = moveAffordance(index, count);

  return (
    <SortableWidgetCell
      id={row.placementId}
      title={widget.title}
      isEditing={isEditing}
      data-testid={`widget-cell-${widget.id}`}
      className={cn(
        // `relative` so the drag handle, which is absolutely positioned, lands
        // on this cell rather than on the grid.
        "relative",
        // 🔴 The PLACEMENT's size wins over the declaration's. The stored size
        // IS the reader's arrangement — the layout API preserves it precisely
        // so a card they resized stays resized — and reading the declaration
        // instead silently re-sized their dashboard whenever a plugin changed
        // its `defaultSize`. `widgetSpanClass` already survives a value this
        // admin does not recognise, which is what makes it safe to hand it one
        // that came from storage rather than from this release's enum.
        widgetSpanClass(row.size ?? widget.size),
        // `empty:hidden` so a widget that drew NOTHING costs no row. A framed
        // widget always renders its card, so this can never hide one; it
        // reaches only an unframed widget whose component returned null --
        // which core's conditional sections do, and did before they were
        // widgets. Without it each becomes a blank cell with a `gap-6` on
        // either side, which is the empty-slot bug rather than the hiding those
        // components have always performed.
        "empty:hidden",
        // An unframed widget is a SECTION, and sections on this page have
        // always been 48px apart -- the `space-y-12` the dashboard used before
        // these became widgets. The grid's own `gap-6` is a card rhythm and
        // right for cards, so the difference belongs to the widgets that are
        // not cards: 24px of trailing margin plus the 24px row gap puts two
        // adjacent sections back at 48px.
        //
        // BOTTOM only. A symmetric `my-3` also pushed the FIRST row down, and
        // the page's outer `space-y-12` already places the grid 48px below the
        // welcome header -- so every dashboard gained 12px there while the
        // inter-section gaps looked correct. Measuring the gaps alone could not
        // see it; only the header-to-first-section distance could.
        //
        // Margins, not padding: a hidden cell contributes neither, but padding
        // would also inset a body that draws its own background.
        widget.chrome === "none" && "mb-6"
      )}
    >
      {isEditing ? (
        <WidgetEditControls
          title={widget.title}
          position={index + 1}
          count={count}
          hidden={row.hidden}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onMoveUp={() => onMove(index, -1)}
          onMoveDown={() => onMove(index, 1)}
          onToggleHidden={() => onToggleHidden(row.placementId)}
          onRemove={() => onRemove(row.placementId)}
        />
      ) : null}
      {/* The dimming wraps the BODY only. Applied to the cell it composited
          every descendant — the controls, the drag handle, their labels and
          their focus rings — so the buttons needed to bring a hidden card back
          were themselves faded, which is the opposite of what the comment
          beside it promised. A hidden card is dimmed so it is not mistaken for
          a live one; the controls that act on it stay legible. */}
      {row.hidden ? (
        <div className="opacity-50">
          <WidgetRenderer
            definition={widget}
            slot={slot}
            updatedAt={updatedAt}
            isFetching={isFetching}
          />
        </div>
      ) : (
        // 🔴 A DIRECT child when nothing is dimmed, because the cell's
        // `empty:hidden` reads `:empty` -- which counts element children, not
        // rendered output. An always-present wrapper made every cell non-empty,
        // so a widget that drew NOTHING stopped collapsing and left a full-width
        // blank slot with its margins. Nothing is lost by branching: a hidden
        // card is only ever drawn while editing, where the controls above are
        // themselves a child and the cell can never be empty anyway.
        <WidgetRenderer
          definition={widget}
          slot={slot}
          updatedAt={updatedAt}
          isFetching={isFetching}
        />
      )}
    </SortableWidgetCell>
  );
}
