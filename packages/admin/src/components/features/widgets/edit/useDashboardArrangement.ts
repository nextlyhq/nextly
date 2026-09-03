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
import {
  columnFromDropData,
  placementsByColumn,
  type DropTarget,
} from "../layout-editor";

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
  /**
   * Its position within that column.
   *
   * Carried so the ONE grouping helper can order these rows, rather than the
   * grid relying on the sequence they happen to arrive in.
   */
  order: number;
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
  /** Swap one card with a named neighbour in the same column. */
  moveWithinColumn: (placementId: string, neighbourId: string) => void;
  /**
   * Move one card into `targetColumn`, named absolutely.
   *
   * The CLICKABLE route across columns. Dragging one there is the same
   * capability, and WCAG 2.2 SC 2.5.7 asks for a single-pointer alternative to
   * anything a drag achieves -- so this is not a convenience beside the drag,
   * it is what makes the drag permissible.
   */
  moveColumn: (placementId: string, targetColumn: number) => void;
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
        order: index,
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
        order: placement.order,
      });
    }
    return rows;
  }, [hasArrangement, declared, editor.placements, editor.isEditing, byId]);

  // The EDITOR's count, which is the draft's while editing and the saved one
  // otherwise. Deriving a second answer here would draw the saved count while
  // the reader is looking at the one they just chose.
  const columnCount = editor.columnCount;

  // 🔴 The SHARED helper, not a second grouping. An inline copy here is the
  // path production takes while the unit tests exercise the helper, so the
  // tests stay green while the shipped grid regresses -- and the two already
  // disagreed, since the helper orders each bucket by `order` and a local copy
  // took whatever sequence the rows arrived in.
  const columns = useMemo(
    () => placementsByColumn(visible, columnCount),
    [visible, columnCount]
  );

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
      if (!event.over) return;
      const moved = visible.find(row => row.placementId === activeId);
      if (!moved) return;
      // 🔴 Read from the droppable's DATA, not from the shape of its id. Only a
      // column carries `widgetColumn`, so a card named like a column cannot be
      // mistaken for one.
      const droppedColumn = columnFromDropData(event.over.data.current);
      const target: DropTarget | null =
        droppedColumn !== undefined
          ? { kind: "column", column: droppedColumn }
          : { kind: "card", placementId: String(event.over.id) };
      if (target.kind === "card" && target.placementId === activeId) return;
      editor.dropOn(activeId, target);
      // 🔴 A drop onto a COLUMN has no neighbouring card to count from, and
      // `findIndex` answers -1 for it. Announced from that, every empty-column
      // drop claimed the card had gone to the last position in the whole
      // dashboard, whichever column actually received it. The column target is
      // parsed instead, and the announcement names the column.
      if (target.kind === "column") {
        announceMove(moved.widget.title, target.column + 1, columnCount);
        return;
      }
      const landed = visible.findIndex(
        row => row.placementId === target.placementId
      );
      announceMove(
        moved.widget.title,
        landed === -1 ? visible.length : landed + 1,
        visible.length
      );
    },
    [visible, editor, announceMove, columnCount]
  );

  /**
   * Move one card into `targetColumn`.
   *
   * 🔴 An ABSOLUTE target, computed by the caller from the column the card is
   * DRAWN in. A delta applied to the stored column is wrong for any card whose
   * column is past the current count: folded into the last column for drawing,
   * it would offer a Left that lands outside the dashboard and a label naming a
   * column the reader cannot see.
   */
  const moveColumn = useCallback(
    (placementId: string, targetColumn: number) => {
      const moved = visible.find(row => row.placementId === placementId);
      if (!moved) return;
      if (targetColumn < 0 || targetColumn >= columnCount) return;
      editor.dropOn(placementId, { kind: "column", column: targetColumn });
      announceMove(moved.widget.title, targetColumn + 1, columnCount);
    },
    [visible, editor, columnCount, announceMove]
  );

  /**
   * The button path: swap one card with a NAMED neighbour.
   *
   * Takes both ids rather than an index and a delta. The caller renders one
   * column and knows which card sits next to which; an index handed back here
   * would have to be re-resolved against the interleaved whole, which is the
   * translation that moved the wrong card.
   */
  const moveWithinColumn = useCallback(
    (placementId: string, neighbourId: string) => {
      const moved = visible.find(row => row.placementId === placementId);
      if (!moved) return;
      editor.dropOn(placementId, { kind: "card", placementId: neighbourId });
      const column = placementsByColumn(visible, columnCount)[
        Math.min(Math.max(0, moved.column ?? 0), columnCount - 1)
      ];
      const landed = column.findIndex(row => row.placementId === neighbourId);
      announceMove(
        moved.widget.title,
        landed === -1 ? column.length : landed + 1,
        column.length
      );
    },
    [visible, editor, columnCount, announceMove]
  );

  return {
    visible,
    editor,
    columns,
    columnCount,
    moveWithinColumn,
    moveColumn,
    hasArrangement,
    sortableItems,
    sensors,
    handleDragEnd,
  };
}
