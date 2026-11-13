/**
 * The rows the outline shows while deletes are pending: the fields now, with
 * each field whose delete is pending shown again at its saved place.
 *
 * A pending delete is a change like any other, so it stays in sight, marked,
 * until it is saved or undone; a field that vanished from the outline the
 * moment it was deleted would leave nothing to see or to undo by. These rows
 * are for showing only: what a save sends is the fields as they are now.
 *
 * @module lib/builder/outline/pending-rows
 */
import type { BuilderField } from "@admin/components/features/schema-builder/types";

import type { PendingChange, RowMark } from "../pending-changes";

import type { OutlineNode } from "./outline-model";

/** Every field id in a tree, at any depth. */
function idsOf(
  fields: readonly BuilderField[],
  into = new Set<string>()
): Set<string> {
  for (const field of fields) {
    into.add(field.id);
    if (field.fields) idsOf(field.fields, into);
  }
  return into;
}

/** Each saved container's fields, by its id; the top level under null. */
function savedChildren(
  fields: readonly BuilderField[],
  parentId: string | null = null,
  into = new Map<string | null, readonly BuilderField[]>()
): Map<string | null, readonly BuilderField[]> {
  into.set(parentId, fields);
  for (const field of fields) {
    if (field.fields) savedChildren(field.fields, field.id, into);
  }
  return into;
}

/**
 * `current`, with every field in `saved` that is no longer anywhere in it put
 * back at its saved place: after the nearest field saved before it that is
 * still in the same container; else before the nearest saved after it; else
 * at the end. A deleted container comes back with the fields it held. With
 * nothing deleted, `current` itself.
 */
export function fieldsWithDeleted(
  current: readonly BuilderField[],
  saved: readonly BuilderField[]
): readonly BuilderField[] {
  const present = idsOf(current);
  const childrenOf = savedChildren(saved);
  let changed = false;

  const level = (
    parentId: string | null,
    fields: readonly BuilderField[]
  ): readonly BuilderField[] => {
    const siblings = childrenOf.get(parentId) ?? [];
    const rows = [...fields];
    for (const [at, gone] of siblings.entries()) {
      if (present.has(gone.id)) continue;
      const indexOf = (id: string) => rows.findIndex(row => row.id === id);
      const before = siblings
        .slice(0, at)
        .map(s => indexOf(s.id))
        .filter(i => i >= 0);
      const after = siblings
        .slice(at + 1)
        .map(s => indexOf(s.id))
        .filter(i => i >= 0);
      const place =
        before.length > 0
          ? Math.max(...before) + 1
          : after.length > 0
            ? Math.min(...after)
            : rows.length;
      rows.splice(place, 0, withoutPresent(gone));
      changed = true;
    }
    // Into the containers still there; a deleted one keeps what it held.
    return rows.map(row =>
      row.fields && present.has(row.id)
        ? { ...row, fields: [...level(row.id, row.fields)] }
        : row
    );
  };

  // A deleted container's fields, less any still here elsewhere: a field
  // moved out before the delete shows where it is now, and only there.
  function withoutPresent(field: BuilderField): BuilderField {
    if (!field.fields) return field;
    return {
      ...field,
      fields: field.fields
        .filter(child => !present.has(child.id))
        .map(withoutPresent),
    };
  }

  const rows = level(null, current);
  return changed ? rows : current;
}

/**
 * `nodes` with each row's pending marks, by field id, and a deleted
 * container's count of the fields that go with it. Rows with no pending
 * change are left as they are; with no marks at all, `nodes` itself.
 */
export function markPending(
  nodes: readonly OutlineNode[],
  marks: ReadonlyMap<string, ReadonlySet<RowMark>>,
  changes: readonly PendingChange[]
): readonly OutlineNode[] {
  if (marks.size === 0) return nodes;
  const inside = new Map(
    changes
      .filter(change => change.kind === "deleted" && change.inside)
      .map(change => [change.fieldId, change.inside])
  );
  const mark = (node: OutlineNode): OutlineNode => {
    const own = marks.get(node.id);
    const children = node.children.map(mark);
    if (!own) return { ...node, children };
    const count = inside.get(node.id);
    return {
      ...node,
      children,
      pending: { marks: [...own], ...(count ? { inside: count } : {}) },
    };
  };
  return nodes.map(mark);
}

/** Whether a row's field is deleted, pending the save. */
export function isPendingDelete(node: OutlineNode): boolean {
  return node.pending?.marks.includes("deleted") ?? false;
}
