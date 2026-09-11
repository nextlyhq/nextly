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

import {
  builderDropAccepted,
  builderRowIndex,
  builderRows,
} from "./builder-rows";
import { findFieldById, findParentContainerId } from "./field-transformers";

/**
 * What a field is called when spoken: its label, else its name, else that
 * it has neither yet.
 *
 * A field just added to the canvas has an empty label AND an empty name until
 * its author fills them in, and it is draggable in that state. Read as
 * `label || name` it was announced as nothing at all -- "Picked up , row 2" --
 * and a row holding one was "and Title". The fallback is a description rather
 * than a placeholder name, so it cannot be mistaken for a field called that.
 */
export function fieldSubject(field: BuilderField): string {
  return field.label || field.name || "an unnamed field";
}

/** "Title", or "First name and Last name" for a row holding two fields. */
function labelsOf(fields: readonly BuilderField[]): string {
  const labels = fields.map(fieldSubject);
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
    return field ? fieldSubject(field) : undefined;
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

  const shared = sortableAnnouncements({ describe, place });
  return {
    ...shared,
    // The landing is spoken only for a drop the handler ACCEPTS, decided by
    // the same predicate the handler decides with. A field released over a
    // field in another container is refused there, and the sentence must say
    // so rather than describe a move that did not happen.
    onDragEnd: ({ active, over }) => {
      if (
        over !== null &&
        over.id !== active.id &&
        !builderDropAccepted(fields, String(active.id), String(over.id))
      ) {
        return `${describe(active) ?? "The item"} cannot move there. Nothing moved.`;
      }
      return shared.onDragEnd({ active, over });
    },
  };
}
