/**
 * Duplicate: the fields with a copy of one field right after it, in its own
 * container, under the first free name (for a nameless layout group, each
 * field it carries under the first free name on the level holding it). A name is free when no sibling's
 * clashes with it by the server's own rule (the same, in other letter case,
 * or the same column), no pending delete there still holds one that does,
 * and the save's field-name rule does not reserve it there (a built-in
 * column, or Draft/Published's own name while it is on).
 *
 * @module lib/builder/duplicate-field
 */
import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { copyWithNewIds } from "./copy-field";
import { freeDuplicateName } from "./duplicate-field-name";
import { nameIsTakenAt } from "./field-name-check";
import { findFieldById, findParentContainerId } from "./field-transformers";
import { insertField, positionAfter } from "./insert-field";
import {
  isLayoutContainer,
  namingSiblingsOf,
  sentName,
  type MoveContext,
} from "./move-rule";

/** What naming a copy needs beyond the fields: the move rule's view of names. */
export type DuplicateNaming = Pick<
  MoveContext,
  "heldNames" | "surface" | "lifecycleEnabled"
>;

/**
 * Whether a copy may not be called `name`: judged as the save will judge it, on the name the save
 * sends, against the named fields on the copy's storage level (a layout group's fields share the
 * level holding it), the names that level's pending deletes still hold, and the names the save's
 * field-name rule reserves there. A name the rule refuses for its spelling or its length is not
 * taken, since no suffix frees it; the settings panel says what is wrong with it on the copy.
 */
function nameTaken(
  copy: BuilderField,
  name: string,
  level: { id: string | null; siblings: readonly BuilderField[] },
  naming: DuplicateNaming | undefined
): boolean {
  const sent = sentName({ ...copy, name });
  const held = naming?.heldNames?.get(level.id ?? "") ?? [];
  return nameIsTakenAt(sent, {
    // Unstated, as a caller that names no entity, only the rules every kind shares are asked.
    surface: naming?.surface ?? "fieldGroup",
    nested: level.id !== null,
    lifecycleEnabled: naming?.lifecycleEnabled === true,
    siblingNames: [...level.siblings.map(sentName), ...held],
  });
}

/**
 * `copy` with every name it puts on its storage level free there: its own, or, for a nameless
 * layout group, the names of the fields it carries, which are stored on that level too. Each is
 * judged against the names given before it, so the copy's fields do not clash with each other.
 */
function withFreeNames(
  copy: BuilderField,
  level: { id: string | null; siblings: readonly BuilderField[] },
  naming: DuplicateNaming | undefined
): BuilderField {
  const given: BuilderField[] = [];
  const rename = (field: BuilderField): BuilderField => {
    if (isLayoutContainer(field)) {
      return { ...field, fields: (field.fields ?? []).map(rename) };
    }
    const seen = { id: level.id, siblings: [...level.siblings, ...given] };
    const named = {
      ...field,
      name: freeDuplicateName(field.name, name =>
        nameTaken(field, name, seen, naming)
      ),
    };
    given.push(named);
    return named;
  };
  return rename(copy);
}

/**
 * `fields` with a copy of `fieldId` right after it, or null when there is no
 * such field. The copy is new all the way down: it and every field inside it
 * get new ids, so editing inside the copy never reaches the original.
 */
export function duplicatedFields(
  fields: readonly BuilderField[],
  fieldId: string,
  naming?: DuplicateNaming
): BuilderField[] | null {
  const source = findFieldById([...fields], fieldId);
  if (!source) return null;
  const containerId =
    findParentContainerId([...fields], fieldId)?.containerId ?? null;
  const siblings = containerId
    ? (findFieldById([...fields], containerId)?.fields ?? [])
    : fields;
  const onLevel = namingSiblingsOf(fields, fieldId);
  const level = {
    id: onLevel?.level?.id ?? null,
    siblings: onLevel?.siblings ?? siblings,
  };
  const copy = withFreeNames(copyWithNewIds(source), level, naming);
  // Read from its own container's list: an id is not unique in the whole tree.
  const position = positionAfter(siblings, fieldId, containerId ?? undefined);
  return position ? insertField(fields, copy, position) : null;
}
