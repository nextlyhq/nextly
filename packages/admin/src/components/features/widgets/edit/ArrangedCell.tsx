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

import { resolveWidgetSettings } from "nextly/config";
import { useMemo, useState } from "react";

import { cn } from "@admin/lib/utils";
import type { WidgetSlot } from "@admin/types/dashboard/widgets";

import type { CellSlotLookup } from "../archetypes/types";
import { moveAffordance, columnAffordance } from "../layout-editor";
import { widgetSpanClass } from "../sizes";
import { WidgetRenderer } from "../WidgetRenderer";

import { SortableWidgetCell } from "./SortableWidgetCell";
import type { ArrangedWidget } from "./useDashboardArrangement";
import { WidgetEditControls } from "./WidgetEditControls";
import { WidgetSettingsSheet } from "./WidgetSettingsSheet";

export interface ArrangedCellProps {
  row: ArrangedWidget;
  isEditing: boolean;
  /**
   * Where this card sits, and among how many.
   *
   * Grouped because the four are one fact read four ways: they decide which
   * moves are possible, and they are what the controls announce. `index` and
   * `count` are positions within THIS column rather than the whole
   * arrangement — the sequence is interleaved across columns, so a global
   * index would offer a move whose neighbour the reader cannot see.
   */
  at: { index: number; count: number; column: number; columnCount: number };
  /**
   * What the batch answered for this card, or its absence.
   *
   * One group because it is one answer: the renderer takes all four together,
   * and `updatedAt`/`isFetching` are `null`/`false` for a card that took no
   * part in the batch rather than being separately meaningful.
   */
  data: {
    slot: WidgetSlot | undefined;
    /** How a `stats` card reaches each cell's answer; absent otherwise. */
    slotFor?: CellSlotLookup;
    /** `null` when this card took no part in the batch. */
    updatedAt: Date | null;
    isFetching: boolean;
  };
  /**
   * What acting on this card does.
   *
   * 🔴 Every one is bound by the CALLER rather than resolved here. `at.index`
   * is a position within the rendered column, and the cell has no way to turn
   * one into the neighbour it should swap with; the writes are keyed by
   * placement, and the cell should not have to know how the editor addresses
   * one.
   */
  on: {
    /** Move this card one step within ITS OWN column. */
    move: (delta: number) => void;
    moveColumn: (placementId: string, targetColumn: number) => void;
    toggleHidden: (placementId: string) => void;
    remove: (placementId: string) => void;
    /** Records what a reader chose for THIS card. */
    saveSettings: (config: Record<string, unknown>) => void;
  };
}

export function ArrangedCell({
  row,
  isEditing,
  at,
  data,
  on,
}: ArrangedCellProps) {
  const { index, count, column, columnCount } = at;
  /*
   * Open state lives with the CELL rather than with the grid: the sheet belongs
   * to one card, and hoisting it would make the grid track which of many is
   * open for no benefit to either.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasSettings = (row.widget.settings?.length ?? 0) > 0;

  const widget = row.widget;
  /*
   * Resolved HERE, the one place a card's declaration and its reader's stored
   * config are both in scope -- the same reason the grid applies settings to
   * the query where it does. `resolveWidgetSettings` returns only DECLARED
   * names, so a component cannot act on a key its widget never offered.
   */
  const placement = useMemo(
    () => ({
      id: row.placementId,
      settings: resolveWidgetSettings(widget.settings, row.config),
    }),
    [row.placementId, widget.settings, row.config]
  );
  /*
   * Bound once here rather than written inline in the JSX below. Each is the
   * cell supplying the one thing its caller's handler cannot know — which
   * placement, or which direction — and inline they turned a flat list of
   * controls into seven nested closures a reader has to step into to see what
   * each button does.
   */
  const moveUp = () => on.move(-1);
  const moveDown = () => on.move(1);
  const moveLeft = () => on.moveColumn(row.placementId, column - 1);
  const moveRight = () => on.moveColumn(row.placementId, column + 1);
  const toggleHidden = () => on.toggleHidden(row.placementId);
  const remove = () => on.remove(row.placementId);
  const openSettings = () => setSettingsOpen(true);
  const { canMoveUp, canMoveDown } = moveAffordance(index, count);
  // Derived from the column this card is DRAWN in. A card stored past the
  // current count is folded into the last column, so computing from the stored
  // value offers a Left that lands outside the dashboard and a label naming a
  // column the reader cannot see.
  const { canMoveLeft, canMoveRight } = columnAffordance(column, columnCount);

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
          card={{
            title: widget.title,
            position: index + 1,
            count,
            // 1-based for the labels, which say "column 2 of 3" to a reader
            // who counts from one.
            column: column + 1,
            columnCount,
            hidden: row.hidden,
          }}
          can={{
            up: canMoveUp,
            down: canMoveDown,
            left: canMoveLeft,
            right: canMoveRight,
          }}
          on={{
            moveUp,
            moveDown,
            moveLeft,
            moveRight,
            toggleHidden,
            remove,
            ...(hasSettings ? { openSettings } : {}),
          }}
        />
      ) : null}
      {/* Mounted whenever the widget offers settings, not only while editing.
          A closed `Sheet` renders nothing, so this costs a card nothing — and
          it is what lets the panel outlive edit mode rather than being torn
          out from under a reader who is still filling it in. */}
      {hasSettings ? (
        <WidgetSettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title={widget.title}
          settings={widget.settings ?? []}
          config={row.config}
          onSave={on.saveSettings}
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
          <WidgetRenderer definition={widget} placement={placement} {...data} />
        </div>
      ) : (
        // 🔴 A DIRECT child when nothing is dimmed, because the cell's
        // `empty:hidden` reads `:empty` -- which counts element children, not
        // rendered output. An always-present wrapper made every cell non-empty,
        // so a widget that drew NOTHING stopped collapsing and left a full-width
        // blank slot with its margins. Nothing is lost by branching: a hidden
        // card is only ever drawn while editing, where the controls above are
        // themselves a child and the cell can never be empty anyway.
        <WidgetRenderer definition={widget} placement={placement} {...data} />
      )}
    </SortableWidgetCell>
  );
}
