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

/** The row index a sortable id names, or undefined for any other id. */
export function builderRowIndex(id: string): number | undefined {
  if (!id.startsWith("row-")) return undefined;
  const index = Number(id.slice("row-".length));
  return Number.isNaN(index) ? undefined : index;
}
