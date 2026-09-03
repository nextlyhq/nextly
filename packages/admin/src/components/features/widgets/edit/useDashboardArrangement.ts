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
  dropSide,
  placementsByColumn,
  resolveDrop,
  type DropSide,
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
  /**
   * Swap one card with a named neighbour in the same column.
   *
   * `side` says whether that neighbour sits above or below, which is the same
   * answer a drag reads off the pointer. The caller renders the column and
   * already knows; resolving it here would be a second reading of the
   * arrangement, free to disagree with the one the reader is looking at.
   */
  moveWithinColumn: (
    placementId: string,
    neighbourId: string,
    side: DropSide
  ) => void;
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
  announceColumn: (
    title: string,
    column: number,
    columnCount: number,
    position: number,
    count: number
  ) => void
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

  /** The placements the grid actually draws, which is what a position counts. */
  const renderedIds = useMemo(
    () => new Set(visible.map(row => row.placementId)),
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

  /**
   * Say where a card ended up, in the terms the reader can verify.
   *
   * 🔴 Resolved AFTER the move, against the destination column's bucket. Read
   * from the global sequence, a card dropped onto the second card of a short
   * column announced "position 4 of 4" because cards in other columns precede
   * it — a position and a total that describe nothing the reader can see.
   */
  const announceLanding = useCallback(
    (title: string, placementId: string, target: DropTarget) => {
      const settled = resolveDrop(
        editor.placements,
        placementId,
        target,
        columnCount
      );
      // 🔴 Counted over the cards the grid DRAWS, not over every stored
      // placement. A placement whose declaration this admin cannot resolve is
      // skipped from the render and still sits in `editor.placements`, so a
      // column holding one announced "position 3 of 3" for a card the reader
      // sees second of two — a position and a total describing a grid nobody
      // is looking at.
      const buckets = placementsByColumn(
        settled.filter(p => renderedIds.has(p.id)),
        columnCount
      );
      const column = buckets.findIndex(bucket =>
        bucket.some(p => p.id === placementId)
      );
      if (column === -1) return;
      const position = buckets[column].findIndex(p => p.id === placementId) + 1;
      announceColumn(
        title,
        column + 1,
        columnCount,
        position,
        buckets[column].length
      );
    },
    [editor.placements, columnCount, announceColumn, renderedIds]
  );

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
          : {
              kind: "card",
              placementId: String(event.over.id),
              // Which SIDE of that card the gesture ended on. A populated
              // column disables its own droppable, so releasing below its last
              // card resolves to that card and the side is the only thing
              // saying the reader meant underneath it rather than above.
              side: dropSide(
                event.active.rect.current.translated,
                event.over.rect
              ),
            };
      if (target.kind === "card" && target.placementId === activeId) return;
      editor.dropOn(activeId, target);
      // 🔴 A drop onto a COLUMN has no neighbouring card to count from, and
      // `findIndex` answers -1 for it. Announced from that, every empty-column
      // drop claimed the card had gone to the last position in the whole
      // dashboard, whichever column actually received it. The column target is
      // parsed instead, and the announcement names the column.
      announceLanding(moved.widget.title, activeId, target);
    },
    [visible, editor, announceLanding]
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
      const target: DropTarget = { kind: "column", column: targetColumn };
      editor.dropOn(placementId, target);
      announceLanding(moved.widget.title, placementId, target);
    },
    [visible, editor, announceLanding, columnCount]
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
    (placementId: string, neighbourId: string, side: DropSide) => {
      const moved = visible.find(row => row.placementId === placementId);
      if (!moved) return;
      // The caller renders the column, so it knows whether the neighbour it
      // named sits above or below — which is exactly the side the card lands
      // on. Deriving it here would answer from the stored arrangement a second
      // time, and the two readings are what already moved the wrong card.
      const target: DropTarget = {
        kind: "card",
        placementId: neighbourId,
        side,
      };
      editor.dropOn(placementId, target);
      announceLanding(moved.widget.title, placementId, target);
    },
    [visible, editor, announceLanding]
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
