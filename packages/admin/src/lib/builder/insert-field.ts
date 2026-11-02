/**
 * Where a new field lands in the Builder's tree.
 *
 * A position names the container (the top level when none) and the field the
 * new one goes before (the end of that container when none). Naming the next
 * field rather than an index keeps "Add and add another" in order: each new
 * field goes before the same anchor, so after the one before it, and hidden or
 * system fields elsewhere in the list never shift the place.
 *
 * @module lib/builder/insert-field
 */
import type { BuilderField } from "@admin/components/features/schema-builder/types";

/** Where a new field goes: inside `parentFieldId`, before `beforeFieldId`. */
export interface FieldInsertPosition {
  /** The group or repeater to add into, at any depth; the top level when absent. */
  parentFieldId?: string;
  /** The sibling to add before; the end of the container when absent or not a sibling. */
  beforeFieldId?: string;
}

/** The fields a container holds, in the two types the Builder nests fields in. */
function isContainer(field: BuilderField): boolean {
  return field.type === "group" || field.type === "repeater";
}

/** `siblings` with `field` before `beforeFieldId`, or at the end. */
function placeAmong(
  siblings: readonly BuilderField[],
  field: BuilderField,
  beforeFieldId: string | undefined
): BuilderField[] {
  const at = siblings.findIndex(sibling => sibling.id === beforeFieldId);
  return at === -1
    ? [...siblings, field]
    : [...siblings.slice(0, at), field, ...siblings.slice(at)];
}

/**
 * A copy of `fields` with `field` added at `position`, or `null` when the
 * container it names is gone or holds no fields: the caller then adds nothing
 * and says so, rather than placing the field somewhere it did not ask for.
 */
export function insertField(
  fields: readonly BuilderField[],
  field: BuilderField,
  position: FieldInsertPosition
): BuilderField[] | null {
  const { parentFieldId, beforeFieldId } = position;
  if (!parentFieldId) return placeAmong(fields, field, beforeFieldId);

  let placed = false;
  const walk = (list: readonly BuilderField[]): BuilderField[] =>
    list.map(item => {
      if (item.id === parentFieldId) {
        if (!isContainer(item)) return item;
        placed = true;
        return {
          ...item,
          fields: placeAmong(item.fields ?? [], field, beforeFieldId),
        };
      }
      return item.fields ? { ...item, fields: walk(item.fields) } : item;
    });
  const next = walk(fields);
  return placed ? next : null;
}

/**
 * The position right after `fieldId` among `siblings`, the list that drew it:
 * before its next sibling, or the end of that list after its last one. This is
 * where "/" on a field adds, so "Add and add another" from there keeps adding
 * after it, in order. `parentFieldId` names the container `siblings` belongs
 * to (none for the top level).
 *
 * Read from the drawn list rather than found by id in the whole tree, because
 * an id is not unique there: a duplicated container's fields keep the ids of
 * the fields they were copied from. `null` when the field is not in the list.
 */
export function positionAfter(
  siblings: readonly BuilderField[],
  fieldId: string,
  parentFieldId?: string
): FieldInsertPosition | null {
  const at = siblings.findIndex(field => field.id === fieldId);
  if (at === -1) return null;
  const next = siblings[at + 1];
  return {
    ...(parentFieldId ? { parentFieldId } : {}),
    ...(next ? { beforeFieldId: next.id } : {}),
  };
}
