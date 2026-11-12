/**
 * What a move says once it is done, and the names a container's pending
 * deletes still hold, both read from the Builder's fields: the sentence a
 * live region announces after a move by key, menu or drag, and the names the
 * move rule and Duplicate keep clear of until a delete is saved.
 *
 * @module lib/builder/move-words
 */
import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { placeAmongSiblings } from "./builder-rows";
import { findFieldById, findParentContainerId } from "./field-transformers";

/** A field's name as a sentence calls it. */
export function spokenFieldName(
  field: BuilderField | null | undefined
): string {
  return field?.label || field?.name || "the field";
}

/** The container a field sits in: null for the top level, undefined when absent. */
function containerOf(
  fields: readonly BuilderField[],
  fieldId: string
): BuilderField | null | undefined {
  if (!findFieldById([...fields], fieldId)) return undefined;
  const parent = findParentContainerId([...fields], fieldId);
  return parent ? (findFieldById([...fields], parent.containerId) ?? null) : null;
}

/**
 * The sentence for a field that moved from where it is in `before` to where
 * it is in `after`: up or down for a step within its container, into the
 * container it entered, or out to the top level; then its place there.
 */
export function movedSentence(
  before: readonly BuilderField[],
  after: readonly BuilderField[],
  fieldId: string,
  step?: "up" | "down"
): string {
  const was = containerOf(before, fieldId);
  const now = containerOf(after, fieldId);
  const name = spokenFieldName(findFieldById([...after], fieldId));
  const where =
    (was?.id ?? null) === (now?.id ?? null)
      ? (step ?? "")
      : now
        ? `into ${spokenFieldName(now)}`
        : "out to the top level";
  const at = placeAmongSiblings(after, fieldId);
  const place = at ? `position ${at.position} of ${at.of}` : "";
  return `Moved ${name}${where ? ` ${where}` : ""}${place ? `, ${place}` : ""}.`;
}

/** Every field id in a tree, at any depth. */
function idsIn(
  fields: readonly BuilderField[],
  into = new Set<string>()
): Set<string> {
  for (const field of fields) {
    into.add(field.id);
    if (field.fields) idsIn(field.fields, into);
  }
  return into;
}

/**
 * The names each container's pending deletes still hold, by the container's
 * id, `""` for the top level: every field saved there that is no longer in
 * the Builder. Until the delete is saved its column is still there, so a
 * field arriving under a name that clashes with it would be refused by the
 * save.
 */
export function heldNamesOf(
  saved: readonly BuilderField[],
  current: readonly BuilderField[]
): Map<string, string[]> {
  const present = idsIn(current);
  const held = new Map<string, string[]>();
  const walk = (list: readonly BuilderField[], containerId: string) => {
    for (const field of list) {
      if (!present.has(field.id) && field.name) {
        held.set(containerId, [...(held.get(containerId) ?? []), field.name]);
      }
      if (field.fields) walk(field.fields, field.id);
    }
  };
  walk(saved, "");
  return held;
}
