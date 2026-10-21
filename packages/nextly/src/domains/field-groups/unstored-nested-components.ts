/**
 * A value for a component placed DIRECTLY in another component's fields, which the write cannot
 * store.
 *
 * A component instance is one row of its component's table, and a component field gets no column
 * on that row (`componentFieldHasColumn`): its instances belong in a table of their own. No write
 * saves instances whose parent is another component, and no read loads them, so such a value was
 * accepted and dropped. It is refused instead, naming the field, so nothing is lost without a word.
 * A component held in a group or a repeater of the outer component is stored in that container's
 * JSON, and is not affected.
 *
 * Any value that holds something is refused. The admin never draws such a field (the schema it
 * reads leaves it out, see `omitDirectComponentFields`), so no form seeds one, and whatever arrives
 * was sent by someone. Only an empty value passes: nothing, an empty list, or an object with no
 * authored key.
 *
 * @module domains/field-groups/unstored-nested-components
 */

import type { FieldConfig } from "../../collections/fields/types";
import type { ValidationIssue } from "../../shared/lib/entry-validation";

import { directComponentFields } from "./direct-component-fields";
import { COMPONENT_META_KEYS } from "./services/field-group-utils";
import { readFieldGroupType } from "./storage/field-group-type-key";

const NOT_STORED: Omit<ValidationIssue, "path"> = {
  code: "NOT_STORED",
  message:
    "A component placed directly in another component is not stored. Put it in a group or repeater.",
};

/** One issue per component field placed directly in `fields` whose value in `instance` holds anything. */
export function unstoredNestedComponentIssues(
  instance: Record<string, unknown>,
  fields: readonly FieldConfig[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of directComponentFields(fields)) {
    const name = field.name as string;
    if (Object.hasOwn(instance, name) && holdsAnything(instance[name])) {
      issues.push({ path: name, ...NOT_STORED });
    }
  }
  return issues;
}

/**
 * Whether a value holds anything: a list with a row, an object with an authored key or that names
 * its component, or anything else that is not nothing. Shallow on purpose: one authored key is
 * enough, so a value is never walked, and one that refers back to itself ends here like any other.
 */
function holdsAnything(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== "object" || value instanceof Date) return true;
  return (
    readFieldGroupType(value) !== undefined ||
    Object.keys(value).some(key => !COMPONENT_META_KEYS.has(key))
  );
}
