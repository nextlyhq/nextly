/**
 * How a field moves within the Builder's outline: the one rule a drag, the
 * menu's Move up and Move down, and their keys all follow.
 *
 * The outline draws one field per row and drags a field by its own id, so a
 * move is a field changing place among its siblings. It stays in its own
 * container, whether that is the top level, a group or repeating rows; moving
 * between containers is not offered here. A built-in field never moves, and
 * nothing moves past it.
 *
 * @module lib/builder/builder-rows
 */

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import {
  findFieldById,
  findParentContainerId,
  reorderNestedFields,
} from "./field-transformers";

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

/**
 * Whether a drop of one field on another is a move this rule allows: two
 * different fields, both the entity's own and not built in, in one container.
 *
 * 🔴 Read by the handler that applies a drop and by the announcement that
 * describes it, so what the reader is told matches what happens: a drop the
 * handler refuses is described as refused, never as "moved to".
 */
export function builderDropAccepted(
  fields: readonly BuilderField[],
  activeId: string,
  overId: string
): boolean {
  if (activeId === overId) return false;
  const around = siblingsOf(fields, activeId);
  if (!around) return false;
  const active = around.find(field => field.id === activeId);
  const over = around.find(field => field.id === overId);
  return Boolean(active && over && !active.isSystem && !over.isSystem);
}

/**
 * Move a field one place up (`-1`) or down (`1`) among its siblings; the
 * fields as they were when there is no such place.
 */
export function moveWithinContainer(
  fields: BuilderField[],
  fieldId: string,
  delta: -1 | 1
): BuilderField[] {
  const around = siblingsOf(fields, fieldId);
  if (!around) return fields;
  const at = around.findIndex(field => field.id === fieldId);
  const target = around[at + delta];
  if (!target || target.isSystem || around[at]?.isSystem) return fields;
  return reorderNestedFields(fields, fieldId, target.id);
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
