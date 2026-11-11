"use client";

/**
 * Where a pointer can add a field in the outline: a "+" in the gap above an
 * editable row, adding before it, and an "Add field" line after the last field
 * of an open group or repeating rows, adding at its end.
 *
 * They are for a pointer, so they stay out of the tree's semantics and its tab
 * order: a keyboard adds through "/" on a row and the row's menu, which reach
 * the same places. None is offered beside or inside a read-only row.
 */
import type { JSX } from "react";

import type { VisibleRow } from "@admin/lib/builder/outline/outline-model";

/** A row to draw, or a place to add a field. */
export type OutlineItem = { kind: "row"; row: VisibleRow } | AddPlaceItem;

export interface AddPlaceItem {
  kind: "before" | "inside";
  key: string;
  /** The row the place is before, or the container it is at the end of. */
  id: string;
  /** The container the new field goes into; null at the top level. */
  parentId: string | null;
  level: number;
  /** Named in the place's title. */
  label: string;
}

/** The width of one level of indent, in pixels, as the rows draw it. */
const INDENT = 20;

function editableContainer(row: VisibleRow): boolean {
  const { node } = row;
  return (
    node.own &&
    node.readOnly === null &&
    (node.container === "group" || node.container === "repeater")
  );
}

/**
 * The rows with the places a field can be added among them, in order. With
 * `enabled` false (a read-only entity, or while finding) only the rows.
 */
export function withAddPlaces(
  rows: readonly VisibleRow[],
  enabled: boolean
): OutlineItem[] {
  if (!enabled) return rows.map(row => ({ kind: "row", row }));
  const byId = new Map(rows.map(row => [row.node.id, row]));
  const items: OutlineItem[] = [];
  const open: VisibleRow[] = [];

  const inside = (container: VisibleRow): AddPlaceItem => ({
    kind: "inside",
    key: `inside:${container.node.id}`,
    id: container.node.id,
    parentId: container.node.id,
    level: container.level + 1,
    label: container.node.field.label || container.node.field.name,
  });
  // Close every open container the next row is not inside.
  const closeTo = (level: number) => {
    while (open.length > 0 && (open[open.length - 1]?.level ?? 0) >= level) {
      const container = open.pop();
      if (container) items.push(inside(container));
    }
  };

  // The row drawn last in each container, so the "+" between two rows knows
  // the row above it.
  const lastIn = new Map<string, VisibleRow>();

  for (const row of rows) {
    closeTo(row.level);
    const parent = row.node.parentId ? byId.get(row.node.parentId) : undefined;
    const parentEditable = parent ? editableContainer(parent) : true;
    const container = row.node.parentId ?? "";
    const above = lastIn.get(container);
    lastIn.set(container, row);
    // Not beside a read-only row either: a "+" between one and the next would
    // be an entry beside it.
    if (
      above !== undefined &&
      above.node.readOnly === null &&
      row.node.own &&
      row.node.readOnly === null &&
      parentEditable
    ) {
      items.push({
        kind: "before",
        key: `before:${row.node.id}`,
        id: row.node.id,
        parentId: row.node.parentId,
        level: row.level,
        label: row.node.field.label || row.node.field.name,
      });
    }
    items.push({ kind: "row", row });
    if (editableContainer(row)) {
      if (row.expanded) open.push(row);
      else if (row.node.children.length === 0) items.push(inside(row));
    }
  }
  closeTo(0);
  return items;
}

export function AddPlace({
  place,
  onAdd,
}: {
  place: AddPlaceItem;
  onAdd: (place: AddPlaceItem) => void;
}): JSX.Element {
  const before = place.kind === "before";
  return (
    <div
      role="none"
      aria-hidden="true"
      className="flex items-center"
      style={{ paddingLeft: (place.level - 1) * INDENT + 28 }}
    >
      <button
        type="button"
        tabIndex={-1}
        data-testid={`${place.kind === "before" ? "add-before" : "add-inside"}-${place.label}`}
        title={
          before
            ? `Add a field before ${place.label}`
            : `Add a field inside ${place.label}`
        }
        onClick={() => onAdd(place)}
        className={
          before
            ? "h-6 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            : "my-0.5 h-8 rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        }
      >
        {before ? "+" : "+ Add field"}
      </button>
    </div>
  );
}
