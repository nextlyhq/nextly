/**
 * Whether a field of a collection has a read rule of its own: one the
 * collection's code declares (kept in the field-functions registry, since a
 * function never survives the stored definition), or one its stored
 * definition carries.
 *
 * A trashed entry's row is gone, so no such rule can be judged for it. The
 * trash shows a field that has one to nobody: its value is not a list's
 * label, nor a conflict's named value.
 *
 * @module domains/trash/field-read-rule
 */
import { getFieldFunctions } from "../../shared/lib/field-level-registry";
import { fieldsStoredOnRow } from "../schema/services/field-column-descriptor";

/** A stored field, as far as its own access is concerned. */
interface StoredField {
  name?: unknown;
  access?: unknown;
}

/** Whether a stored definition's own `access` names a read rule. */
function storedReadRule(field: StoredField | undefined): boolean {
  const access = field?.access;
  return (
    typeof access === "object" &&
    access !== null &&
    (access as { read?: unknown }).read !== undefined
  );
}

/**
 * Whether the field `name` of `collection`, stored on the entry's row among
 * `fields`, has a read rule of its own.
 */
export function fieldHasReadRule(
  collection: string,
  name: string,
  fields: readonly StoredField[]
): boolean {
  const declared = getFieldFunctions("collection", collection)?.[name];
  if (declared?.access?.read !== undefined) return true;
  return storedReadRule(
    fieldsStoredOnRow(fields).find(field => field.name === name)
  );
}
