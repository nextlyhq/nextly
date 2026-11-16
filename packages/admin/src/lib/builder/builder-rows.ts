/**
 * Where a field sits among its siblings in the Builder, for a sentence that
 * says so. Where a field may move is the move rule's (`move-rule`).
 *
 * @module lib/builder/builder-rows
 */

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { findFieldById, findParentContainerId } from "./field-transformers";

/** The fields a field sits among, itself included, or null if it is not one of `fields`. */
function siblingsOf(
  fields: readonly BuilderField[],
  fieldId: string
): readonly BuilderField[] | null {
  if (!findFieldById([...fields], fieldId)) return null;
  const parent = findParentContainerId([...fields], fieldId);
  if (!parent) return fields;
  return findFieldById([...fields], parent.containerId)?.fields ?? null;
}

/** Where a field sits among its siblings, counting from 1, for an announcement. */
export function placeAmongSiblings(
  fields: readonly BuilderField[],
  fieldId: string
): { position: number; of: number } | null {
  const around = siblingsOf(fields, fieldId)?.filter(field => !field.isSystem);
  if (!around) return null;
  const at = around.findIndex(field => field.id === fieldId);
  return at === -1 ? null : { position: at + 1, of: around.length };
}
