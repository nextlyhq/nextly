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
import { isPendingDelete } from "@admin/lib/builder/outline/pending-rows";

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
    !isPendingDelete(node) &&
    (node.container === "group" || node.container === "repeater")
  );
}

/** The place at the end of an open, editable container. */
function insidePlace(container: VisibleRow): AddPlaceItem {
  return {
    kind: "inside",
    key: `inside:${container.node.id}`,
    id: container.node.id,
    parentId: container.node.id,
    level: container.level + 1,
    label: container.node.field.label || container.node.field.name,
  };
}

/**
 * The place before `row`, between it and the row above it in its container,
 * or null where none is offered: above the first row, inside a read-only
 * container, and beside a read-only row on either side.
 */
function beforePlace(
  row: VisibleRow,
  above: VisibleRow | undefined,
  parent: VisibleRow | undefined
): AddPlaceItem | null {
  // Nor before a deleted row: the builder no longer holds it to add beside.
  const editable =
    row.node.own && row.node.readOnly === null && !isPendingDelete(row.node);
  const parentEditable = parent ? editableContainer(parent) : true;
  if (!above || above.node.readOnly !== null || !editable || !parentEditable) {
    return null;
  }
  return {
    kind: "before",
    key: `before:${row.node.id}`,
    id: row.node.id,
    parentId: row.node.parentId,
    level: row.level,
    label: row.node.field.label || row.node.field.name,
  };
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
  // Open editable containers, innermost last: each gets its end place once
  // the rows inside it are drawn.
  const open: VisibleRow[] = [];
  const closeTo = (level: number) => {
    while ((open[open.length - 1]?.level ?? 0) >= level && open.length > 0) {
      items.push(insidePlace(open.pop() as VisibleRow));
    }
  };
  // The row drawn last in each container: the row above the next one there.
  const lastIn = new Map<string, VisibleRow>();

  for (const row of rows) {
    closeTo(row.level);
    const container = row.node.parentId ?? "";
    const parent = row.node.parentId ? byId.get(row.node.parentId) : undefined;
    const place = beforePlace(row, lastIn.get(container), parent);
    lastIn.set(container, row);
    if (place) items.push(place);
    items.push({ kind: "row", row });
    if (!editableContainer(row)) continue;
    if (row.expanded) open.push(row);
    else if (row.node.children.length === 0) items.push(insidePlace(row));
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
