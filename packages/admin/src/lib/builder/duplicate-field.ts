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
import type { MoveContext } from "./move-rule";

/** What naming a copy needs beyond the fields: the move rule's view of names. */
export type DuplicateNaming = Pick<
  MoveContext,
  "heldNames" | "topLevelReservesNames"
>;

/** Whether a copy may not be called `name` beside `siblings`. */
function nameTaken(
  name: string,
  siblings: readonly BuilderField[],
  containerId: string | null,
  naming: DuplicateNaming | undefined
): boolean {
  const held = naming?.heldNames?.get(containerId ?? "") ?? [];
  const reserved =
    containerId === null &&
    naming?.topLevelReservesNames === true &&
    isReservedFieldName(name);
  return (
    reserved ||
    siblings.some(sibling => siblingNameClash(name, sibling.name) !== null) ||
    held.some(other => siblingNameClash(name, other) !== null)
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
  const copy: BuilderField = {
    ...copyWithNewIds(source),
    name: freeDuplicateName(source.name, name =>
      nameTaken(name, siblings, containerId, naming)
    ),
  };
  // Read from its own container's list: an id is not unique in the whole tree.
  const position = positionAfter(siblings, fieldId, containerId ?? undefined);
  return position ? insertField(fields, copy, position) : null;
}
