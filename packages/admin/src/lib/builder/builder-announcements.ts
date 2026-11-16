/**
 * What a drag in the Builder's outline says.
 *
 * A field drags by its own id, so a sentence names the field by its label and
 * places it among the fields of its own container. What a drop on a row did
 * is said by the outline, which judges it by the move rule with the sideways
 * offset this context's sentences never see; here only a drop over nothing.
 *
 * @module lib/builder/builder-announcements
 */

import type { Announcements } from "@dnd-kit/core";

import {
  sortableAnnouncements,
  type AnnouncedItem,
} from "@admin/components/features/entries/fields/structured/field-array-helpers";
import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { placeAmongSiblings } from "./builder-rows";
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
function fieldSubject(field: BuilderField): string {
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
    // A drop on a row is announced by the outline, from the move rule's
    // answer, so it is never said twice or differently here.
    onDragEnd: ({ active, over }) =>
      over === null ? shared.onDragEnd({ active, over }) : undefined,
  };
}
