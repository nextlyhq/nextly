/**
 * What a drag on the schema builder canvas says.
 *
 * The canvas speaks two drag vocabularies: a top-level field drags by the
 * index of the row it was packed into, and a nested child drags by its own
 * field id within its container. A sentence has to name what the reader
 * sees in either case — the labels of the fields in a row, or one field's
 * label — and place a row by its index among the rows actually drawn, which
 * is why this reads the same packing the list draws from.
 *
 * @module lib/builder/builder-announcements
 */

import type { Announcements } from "@dnd-kit/core";

import {
  sortableAnnouncements,
  type AnnouncedItem,
} from "@admin/components/features/entries/fields/structured/field-array-helpers";
import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { builderRowIndex, builderRows } from "./builder-rows";
import { findFieldById, findParentContainerId } from "./field-transformers";

/** "Title", or "First name and Last name" for a row holding two fields. */
function labelsOf(fields: readonly BuilderField[]): string {
  const labels = fields.map(f => f.label || f.name);
  if (labels.length <= 1) return labels[0] ?? "an empty row";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function builderAnnouncements(
  fields: readonly BuilderField[]
): Announcements {
  const rows = builderRows(fields);

  const describe = ({ id }: AnnouncedItem): string | undefined => {
    const rowIndex = builderRowIndex(String(id));
    if (rowIndex !== undefined) {
      const row = rows[rowIndex];
      return row ? labelsOf(row.map(item => item._field)) : undefined;
    }
    const field = findFieldById([...fields], String(id));
    return field ? field.label || field.name : undefined;
  };

  const place = ({ id }: AnnouncedItem): string | undefined => {
    const rowIndex = builderRowIndex(String(id));
    if (rowIndex !== undefined) {
      return rowIndex < rows.length
        ? `row ${rowIndex + 1} of ${rows.length}`
        : undefined;
    }
    // A nested child sits among its container's children.
    const parent = findParentContainerId([...fields], String(id));
    if (!parent) return undefined;
    const siblings =
      findFieldById([...fields], parent.containerId)?.fields ?? [];
    const index = siblings.findIndex(f => f.id === String(id));
    return index === -1
      ? undefined
      : `position ${index + 1} of ${siblings.length}`;
  };

  return sortableAnnouncements({ describe, place });
}
