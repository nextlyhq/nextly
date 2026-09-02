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

import { useCallback, useMemo } from "react";

import type { UseDashboardLayoutResult } from "@admin/hooks/queries/useDashboardLayout";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { useSortableFieldArray } from "../../entries/fields/structured/field-array-helpers";

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
}

export interface DashboardArrangement {
  /** The cards to draw, in the arrangement's order. */
  visible: ArrangedWidget[];
  editor: LayoutEditor;
  /** Move the card at a VIEW index one step, resolving ids for the editor. */
  moveBy: (index: number, delta: number) => void;
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

  // What an added card inherits. `size` on a resolved declaration IS its
  // declared default, so a card the reader adds arrives the size its author
  // intended rather than an arbitrary one.
  const geometryFor = useCallback(
    (widgetId: string) => {
      const declaration = byId.get(widgetId);
      return declaration ? { size: declaration.size } : undefined;
    },
    [byId]
  );

  const editor = useLayoutEditor(layout, geometryFor);
  const hasArrangement = layout.layout !== undefined;

  const visible = useMemo(() => {
    // No arrangement yet: draw the declarations in their declared order, which
    // is exactly what this dashboard did before it could be arranged at all.
    if (!hasArrangement) {
      return declared.map(widget => ({
        placementId: widget.id,
        widget,
        hidden: false,
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
      });
    }
    return rows;
  }, [hasArrangement, declared, editor.placements, editor.isEditing, byId]);

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
  const { sensors, handleDragEnd } = useSortableFieldArray(
    sortableItems,
    (from, to) => {
      const moved = visible[from];
      const target = visible[to];
      if (!moved || !target) return;
      editor.move(moved.placementId, target.placementId);
      announceMove(moved.widget.title, to + 1, visible.length);
    }
  );

  /**
   * The button path: move the card at `index` one step in the VIEW.
   *
   * Resolved to the neighbour's id here rather than to `index + delta`, because
   * the neighbour in the view may not be the neighbour in the stored array.
   */
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
    moveBy,
    hasArrangement,
    sortableItems,
    sensors,
    handleDragEnd,
  };
}
