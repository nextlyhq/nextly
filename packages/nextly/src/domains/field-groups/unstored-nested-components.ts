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
 * Only a value that carries something is refused. The admin's form seeds a nested component with
 * its fields' defaults whether or not anyone touched it, and a write of an outer component that
 * still holds only those would otherwise be refused for a value nobody gave.
 *
 * @module domains/field-groups/unstored-nested-components
 */

import { isDeepStrictEqual } from "node:util";

import type { FieldConfig } from "../../collections/fields/types";
import type { ValidationIssue } from "../../shared/lib/entry-validation";
import type { ComponentFieldResolver } from "../versions/tag-component-types";

import { directComponentFields } from "./direct-component-fields";
import { COMPONENT_META_KEYS } from "./services/field-group-utils";
import {
  extractFieldGroupReferences,
  isFieldGroupFieldType,
} from "./storage/field-group-field-type";
import { readFieldGroupType } from "./storage/field-group-type-key";

/** The field shape this walk reads: a name, a type, children, a declared default, and whether it is virtual. */
type Field = {
  name?: string;
  type?: unknown;
  virtual?: unknown;
  options?: unknown;
  fields?: Field[];
  defaultValue?: unknown;
};

const NOT_STORED: Omit<ValidationIssue, "path"> = {
  code: "NOT_STORED",
  message:
    "A component placed directly in another component is not stored. Put it in a group or repeater.",
};

/**
 * One issue per component field placed directly in `fields` whose value in `instance` carries
 * something. `resolve` gives a nested component's own fields, so a value equal to their defaults
 * reads as seeded rather than given; without it only empty values pass.
 */
export function unstoredNestedComponentIssues(
  instance: Record<string, unknown>,
  fields: readonly FieldConfig[],
  resolve: ComponentFieldResolver | undefined
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of directComponentFields(fields)) {
    const name = field.name as string;
    if (!Object.hasOwn(instance, name)) continue;
    if (componentCarries(instance[name], field as Field, resolve)) {
      issues.push({ path: name, ...NOT_STORED });
    }
  }
  return issues;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/** The fields of the component an instance of `field` is: its one component, or the zone row's. */
function componentSchema(
  field: Field,
  instance: Record<string, unknown>,
  resolve: ComponentFieldResolver | undefined
): Field[] | undefined {
  const { single, many } = extractFieldGroupReferences(field);
  const named = readFieldGroupType(instance);
  const slug = single ?? (named && many?.includes(named) ? named : undefined);
  return slug ? resolve?.(slug) : undefined;
}

/** Whether a component field's value, one instance or a list of them, carries anything. */
function componentCarries(
  value: unknown,
  field: Field,
  resolve: ComponentFieldResolver | undefined
): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some(row => componentCarries(row, field, resolve));
  }
  // Not an instance at all: nothing could store it, so it is not passed over as empty.
  if (!isPlainObject(value)) return true;
  return entriesCarry(value, componentSchema(field, value, resolve), resolve);
}

/** Whether any authored key of an object carries a value, judged against its fields. */
function entriesCarry(
  value: Record<string, unknown>,
  fields: Field[] | undefined,
  resolve: ComponentFieldResolver | undefined
): boolean {
  return Object.entries(value).some(
    ([key, child]) =>
      !COMPONENT_META_KEYS.has(key) &&
      valueCarries(
        child,
        fields?.find(field => field.name === key),
        resolve
      )
  );
}

/** Unset the way an untouched form input is: nothing, an empty string, or an unticked checkbox. */
function isUnset(value: unknown): boolean {
  return (
    value === null || value === undefined || value === "" || value === false
  );
}

/** The value its field declares as its default, which a form seeds without anyone choosing it. */
function isDeclaredDefault(value: unknown, field: Field | undefined): boolean {
  return (
    field?.defaultValue !== undefined &&
    isDeepStrictEqual(value, field.defaultValue)
  );
}

/**
 * Whether one value carries anything: not empty, not `false` (an unticked checkbox), and not its
 * field's declared default. A group's or repeater row's object is judged by its own fields, and a
 * component's by its component's.
 */
function valueCarries(
  value: unknown,
  field: Field | undefined,
  resolve: ComponentFieldResolver | undefined
): boolean {
  if (isUnset(value) || isDeclaredDefault(value, field)) return false;
  if (field && isFieldGroupFieldType(field.type)) {
    return componentCarries(value, field, resolve);
  }
  if (Array.isArray(value)) {
    return value.some(item => valueCarries(item, field, resolve));
  }
  if (isPlainObject(value)) return entriesCarry(value, field?.fields, resolve);
  return true;
}
