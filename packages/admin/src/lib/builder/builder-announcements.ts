/**
 * What a drag in the Builder's outline says.
 *
 * A field drags by its own id and moves among its siblings, so a sentence
 * names the field by its label and places it among the fields of its own
 * container. Whether a drop is a move is decided by the rule the drop handler
 * applies (`builderDropAccepted`), so a refused drop is said to be refused.
 *
 * @module lib/builder/builder-announcements
 */

import type { Announcements } from "@dnd-kit/core";

import {
  sortableAnnouncements,
  type AnnouncedItem,
} from "@admin/components/features/entries/fields/structured/field-array-helpers";
import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { builderDropAccepted, placeAmongSiblings } from "./builder-rows";
import { findFieldById } from "./field-transformers";

/**
 * What a field is called when spoken: its label, else its name, else that
 * it has neither yet.
 *
 * A field just added has an empty label AND an empty name until its author
 * fills them in, and it can be dragged in that state. The fallback is a
 * description rather than a placeholder name, so it cannot be mistaken for a
 * field called that.
 */
export function fieldSubject(field: BuilderField): string {
  return field.label || field.name || "an unnamed field";
}

export function builderAnnouncements(
  fields: readonly BuilderField[]
): Announcements {
  const describe = ({ id }: AnnouncedItem): string | undefined => {
    const field = findFieldById([...fields], String(id));
    return field ? fieldSubject(field) : undefined;
  };

  const place = ({ id }: AnnouncedItem): string | undefined => {
    const at = placeAmongSiblings(fields, String(id));
    return at ? `position ${at.position} of ${at.of}` : undefined;
  };

  const shared = sortableAnnouncements({ describe, place });
  return {
    ...shared,
    // The landing is spoken only for a drop the handler ACCEPTS, decided by
    // the same predicate the handler decides with.
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
