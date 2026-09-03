"use client";

/**
 * Which cards the grid draws, in what order, and everything editing them needs.
 *
 * Extracted because the grid had accumulated six jobs — batching queries,
 * gating them, announcing outcomes, resolving the arrangement, holding edit
 * state and wiring drag — and the complexity gate said so before a reader
 * would have. The three that belong to the ARRANGEMENT live here; the grid
 * keeps the three that belong to drawing and fetching.
 *
 * @module components/features/widgets/edit/useDashboardArrangement
 */

import type { DragEndEvent } from "@dnd-kit/core";
import { DEFAULT_COLUMN_COUNT } from "nextly/config";
import { useCallback, useMemo } from "react";

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { useSortableFieldArray } from "../../entries/fields/structured/field-array-helpers";
import { columnDropId } from "../layout-editor";

import { useLayoutEditor, type LayoutEditor } from "./useLayoutEditor";

/** One card to draw: which placement put it there, and whether it is put away. */
export interface ArrangedWidget {
  placementId: string;
  widget: DashboardWidget;
  hidden: boolean;
  /**
   * The size the reader's arrangement stored, when it stored one.
   *
   * A `string` rather than the size enum, for the reason every layout type is:
   * it may have been written by a plugin built against a newer core, and the
   * span helper already falls back on a value it does not recognise.
   */
  size?: string;
  /** Which column this card is drawn in. Absent on a pre-column arrangement. */
  column?: number;
}

export interface DashboardArrangement {
  /** The cards to draw, in the arrangement's order. */
  visible: ArrangedWidget[];
  /**
   * The same cards, grouped into the columns the grid renders.
   *
   * Derived from `visible` rather than resolved a second time: two answers to
   * "which cards are drawn" drift, and the one nobody looks at is the one that
   * goes wrong. Always `columnCount` buckets, empty ones included, because a
   * column is a drop target only while the grid draws it.
   */
  columns: ArrangedWidget[][];
  /** How many columns this reader arranged their dashboard into. */
  columnCount: number;
  editor: LayoutEditor;
  /** Move the card at a VIEW index one step, resolving ids for the editor. */
  moveBy: (index: number, delta: number) => void;
  /**
   * Move one card sideways by `delta` columns.
   *
   * The CLICKABLE route across columns. Dragging one there is the same
   * capability, and WCAG 2.2 SC 2.5.7 asks for a single-pointer alternative to
   * anything a drag achieves -- so this is not a convenience beside the drag,
   * it is what makes the drag permissible.
   */
  moveColumn: (placementId: string, delta: number) => void;
  /**
   * Whether an arrangement has been READ — not whether it holds anything.
   *
   * 🔴 Absent means the request is in flight or it failed; empty means this
   * reader has arranged their dashboard down to nothing. Folding the two
   * together blanked the whole dashboard for the duration of every page load
   * and the whole of any outage.
   */
  hasArrangement: boolean;
  sortableItems: Array<{ id: string }>;
  sensors: ReturnType<typeof useSortableFieldArray>["sensors"];
  handleDragEnd: ReturnType<typeof useSortableFieldArray>["handleDragEnd"];
}

export function useDashboardArrangement(
  declared: DashboardWidget[],
  layout: UseDashboardLayoutResult,
  announceMove: (title: string, position: number, count: number) => void
): DashboardArrangement {
  // The DECLARATIONS, by id. The arrangement says which cards and in what
  // order; this says what each one actually is. Two questions, two sources:
  // the server owns the arrangement because only it can filter by permission
  // authoritatively, and branding owns the declaration because that carries the
  // archetype, the query and the component.
  const byId = useMemo(
    () => new Map(declared.map(widget => [widget.id, widget])),
    [declared]
  );

  // What an added card inherits. `size` and `height` on a resolved declaration
  // ARE its declared defaults, so a card the reader adds arrives the geometry
  // its author intended rather than an arbitrary one.
  //
  // 🔴 BOTH, not just the width. `defaultPlacements` copies a declared
  // `defaultHeight` onto the server's initial placement, so returning only the
  // size here meant removing a card and adding it back replaced a tall one with
  // a card of no stated height -- and the next save persisted that, dropping a
  // declared geometry permanently through a gesture that reads as undoable.
  const geometryFor = useCallback(
    (widgetId: string) => {
      const declaration = byId.get(widgetId);
      if (!declaration) return undefined;
      return {
        size: declaration.size,
        ...(declaration.height === undefined
          ? {}
          : { height: declaration.height }),
      };
    },
    [byId]
  );

  const editor = useLayoutEditor(layout, geometryFor);
  const hasArrangement = layout.layout !== undefined;

  const visible = useMemo(() => {
    // No arrangement yet: draw the declarations in their declared order, which
    // is exactly what this dashboard did before it could be arranged at all.
    if (!hasArrangement) {
      // Dealt across the columns exactly as the server's defaults are, so the
      // dashboard a reader sees before they arrange anything matches the one
      // they get the moment they save.
      return declared.map((widget, index) => ({
        placementId: widget.id,
        widget,
        hidden: false,
        column: index % DEFAULT_COLUMN_COUNT,
      }));
    }
    const rows: ArrangedWidget[] = [];
    for (const placement of editor.placements) {
      const widget = byId.get(placement.widgetId);
      // A placement whose declaration this admin cannot resolve is SKIPPED
      // rather than drawn as an empty cell: the server filtered by permission
      // and by the registry, but a plugin's client bundle can still be absent,
      // and a titled card with nothing under it reads as a product bug.
      if (!widget) continue;
      // Hidden cards are drawn while editing — a reader cannot bring back
      // something they cannot see.
      if (placement.hidden && !editor.isEditing) continue;
      rows.push({
        placementId: placement.id,
        widget,
        hidden: placement.hidden,
        ...(placement.size === undefined ? {} : { size: placement.size }),
        ...(placement.column === undefined ? {} : { column: placement.column }),
      });
    }
    return rows;
  }, [hasArrangement, declared, editor.placements, editor.isEditing, byId]);

  // The reader's own count, or the default while the arrangement is unread.
  // Read from the SERVER's answer rather than assumed: the count decides which
  // column a placement's coordinate names, so a client picking its own would
  // draw an arrangement the reader never made.
  const columnCount = layout.layout?.columnCount ?? DEFAULT_COLUMN_COUNT;

  const columns = useMemo(() => {
    const buckets: ArrangedWidget[][] = Array.from(
      { length: Math.max(1, columnCount) },
      () => []
    );
    for (const row of visible) {
      const declaredColumn = row.column ?? 0;
      const index = Math.min(Math.max(0, declaredColumn), buckets.length - 1);
      buckets[index].push(row);
    }
    return buckets;
  }, [visible, columnCount]);

  const sortableItems = useMemo(
    () => visible.map(row => ({ id: row.placementId })),
    [visible]
  );

  // The drag path and the button path move a card through the SAME function.
  // Two implementations of "where does this land" agree until one is edited,
  // and a grid whose drag and whose buttons disagreed would be impossible to
  // reason about from either.
  // `useSortableFieldArray` hands back INDICES into the list it was given, and
  // that list is the filtered view. They are turned into placement ids here,
  // once, so the editor never sees a position that means something different to
  // it than it did to the grid.
  // Only the SENSORS are borrowed. `useSortableFieldArray` resolves a drop to a
  // pair of indices into one list, which cannot express a column: an index says
  // where in a sequence a card landed and says nothing about which column it
  // landed in. The sensors are the half that is genuinely shared -- a pointer
  // and a keyboard sensor, configured identically wherever this admin drags.
  const { sensors } = useSortableFieldArray(sortableItems, () => {});

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      if (overId === null || overId === activeId) return;
      const moved = visible.find(row => row.placementId === activeId);
      if (!moved) return;
      editor.dropOn(activeId, overId);
      // Announced from the position the card is moving TO, resolved against
      // the view it was dropped in. A card dropped onto a column has no
      // neighbour to count from, so it is announced as the column's arrival
      // rather than with a position that would be invented.
      const target = visible.findIndex(row => row.placementId === overId);
      announceMove(
        moved.widget.title,
        target === -1 ? visible.length : target + 1,
        visible.length
      );
    },
    [visible, editor, announceMove]
  );

  /**
   * The button path: move the card at `index` one step in the VIEW.
   *
   * Resolved to the neighbour's id here rather than to `index + delta`, because
   * the neighbour in the view may not be the neighbour in the stored array.
   */
  const moveColumn = useCallback(
    (placementId: string, delta: number) => {
      const moved = visible.find(row => row.placementId === placementId);
      if (!moved) return;
      const target = (moved.column ?? 0) + delta;
      // Refused rather than clamped. Clamping would let a button that LOOKS
      // disabled still act -- the affordance and the handler would disagree,
      // and the one a reader trusts is whichever moved the card.
      if (target < 0 || target >= columnCount) return;
      editor.dropOn(placementId, columnDropId(target));
      announceMove(moved.widget.title, target + 1, columnCount);
    },
    [visible, editor, columnCount, announceMove]
  );

  const moveBy = useCallback(
    (index: number, delta: number) => {
      const moved = visible[index];
      const target = visible[index + delta];
      if (!moved || !target) return;
      editor.move(moved.placementId, target.placementId);
      announceMove(moved.widget.title, index + delta + 1, visible.length);
    },
    [visible, editor, announceMove]
  );

  return {
    visible,
    editor,
    columns,
    columnCount,
    moveBy,
    moveColumn,
    hasArrangement,
    sortableItems,
    sensors,
    handleDragEnd,
  };
}
