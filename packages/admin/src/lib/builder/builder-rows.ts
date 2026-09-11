/**
 * The rows the schema builder DRAWS, derived once.
 *
 * 🔴 A top-level drag on the builder canvas is expressed against row indices —
 * `row-2` is whatever the field list packed into its third row — so anything
 * that reads a row id has to pack the same fields with the same widths, or it
 * names a different row from the one on screen. Two packings had grown apart:
 * the list dropped hidden fields and forced a repeater or group onto its own
 * full-width row, while the reorder that consumed its ids did neither. With a
 * hidden field above, or a half-width repeater, the row the reader dragged
 * and the row the reorder moved were different rows.
 *
 * This is the one packing. The list draws from it, the reorder applies to it,
 * and a drag announcement names rows out of it.
 *
 * @module lib/builder/builder-rows
 */

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { findParentContainerId } from "./field-transformers";
import { packIntoRows, parseWidth, type WidthField } from "./reflow";

/** One field as the row packer sees it, carrying the field it stands for. */
export type BuilderRowItem = WidthField & { _field: BuilderField };

/**
 * The editable fields, packed into rows by width.
 *
 * System fields are not packed: they are drawn apart and stay ahead of any
 * reordered result. Hidden fields are plumbing — a plugin's mode field driven
 * by a form toolbar — and are not drawn, so they take no row. A repeater or
 * group always takes a full row so its nested group has horizontal room; the
 * author's stored width still applies at content-edit time.
 */
export function builderRows(
  fields: readonly BuilderField[]
): BuilderRowItem[][] {
  const userFields = fields.filter(
    f => !f.isSystem && f.admin?.hidden !== true
  );
  return packIntoRows<BuilderRowItem>(
    userFields.map(f => ({
      id: f.id,
      width:
        f.type === "repeater" || f.type === "group"
          ? 100
          : parseWidth(f.admin?.width),
      _field: f,
    }))
  );
}

/** The sortable id the field list gives the row at `index`. */
export function builderRowId(index: number): string {
  return `row-${index}`;
}

/**
 * The row index a sortable id names, or undefined for any other id.
 *
 * Only the ids `builderRowId` mints -- `row-` and a canonical nonnegative
 * integer -- name a row. `Number()` alone read `row--1` as -1 and `row-1.5`
 * as a fraction, and each passed the acceptance rule's upper bound while the
 * reorder refused it, so the announcement described a move the handler had
 * just declined.
 */
export function builderRowIndex(id: string): number | undefined {
  const match = /^row-(0|[1-9][0-9]*)$/.exec(id);
  return match ? Number(match[1]) : undefined;
}

/**
 * Whether a drag between two fields stays inside one container.
 *
 * Moving a field out of its group or repeater is deliberately not supported,
 * so a drag whose ends have different parents is a no-op rather than a move.
 */
export function isSameContainerDrag(
  fields: readonly BuilderField[],
  activeId: string,
  overId: string
): boolean {
  const activeParent = findParentContainerId([...fields], activeId);
  const overParent = findParentContainerId([...fields], overId);
  return Boolean(
    activeParent &&
      overParent &&
      activeParent.containerId === overParent.containerId
  );
}

/**
 * Whether a drop on the canvas is one the drop handler will act on.
 *
 * 🔴 The ONE acceptance rule, read by the handler that applies a drop and by
 * the announcement that describes it. A nested field may move within its own
 * container; a row may move among the rows; anything else -- a field over a
 * row, a row over a field, a field over a field in another container -- is
 * refused and the tree stands. An announcement that decided this for itself
 * said "moved to" for a drop the handler had just refused.
 */
export function builderDropAccepted(
  fields: readonly BuilderField[],
  activeId: string,
  overId: string
): boolean {
  if (activeId === overId) return false;
  const activeRow = builderRowIndex(activeId);
  const overRow = builderRowIndex(overId);
  if (activeRow !== undefined || overRow !== undefined) {
    if (activeRow === undefined || overRow === undefined) return false;
    const count = builderRows(fields).length;
    return activeRow < count && overRow < count;
  }
  return isSameContainerDrag(fields, activeId, overId);
}
