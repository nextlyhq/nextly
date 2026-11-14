/**
 * Duplicate: the fields with a copy of one field right after it, in its own
 * container, under the first free name. A name is free when no sibling's
 * clashes with it by the server's own rule (the same, in other letter case,
 * or the same column), no pending delete there still holds one that does,
 * and it is not reserved there.
 *
 * @module lib/builder/duplicate-field
 */
import { siblingNameClash } from "nextly/config";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { isReservedFieldName } from "./constants";
import { copyWithNewIds } from "./copy-field";
import { freeDuplicateName } from "./duplicate-field-name";
import { findFieldById, findParentContainerId } from "./field-transformers";
import { insertField, positionAfter } from "./insert-field";
import { namingSiblingsOf, sentName, type MoveContext } from "./move-rule";

/** What naming a copy needs beyond the fields: the move rule's view of names. */
export type DuplicateNaming = Pick<
  MoveContext,
  "heldNames" | "topLevelReservesNames"
>;

/**
 * Whether a copy may not be called `name`: judged as the save will judge it, on the name the save
 * sends, against the named fields on the copy's storage level (a layout group's fields share the
 * level holding it), the names that level's pending deletes still hold, and the top level's
 * reserved names.
 */
function nameTaken(
  copy: BuilderField,
  name: string,
  level: { id: string | null; siblings: readonly BuilderField[] },
  naming: DuplicateNaming | undefined
): boolean {
  const sent = sentName({ ...copy, name });
  const held = naming?.heldNames?.get(level.id ?? "") ?? [];
  const reserved =
    level.id === null &&
    naming?.topLevelReservesNames === true &&
    isReservedFieldName(sent);
  return (
    reserved ||
    level.siblings.some(
      sibling => siblingNameClash(sent, sentName(sibling)) !== null
    ) ||
    held.some(other => siblingNameClash(sent, other) !== null)
  );
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
  const fresh = copyWithNewIds(source);
  const copy: BuilderField = {
    ...fresh,
    name: freeDuplicateName(source.name, name =>
      nameTaken(fresh, name, level, naming)
    ),
  };
  // Read from its own container's list: an id is not unique in the whole tree.
  const position = positionAfter(siblings, fieldId, containerId ?? undefined);
  return position ? insertField(fields, copy, position) : null;
}
