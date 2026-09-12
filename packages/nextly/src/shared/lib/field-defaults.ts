/**
 * Applying declared field defaults to a new entry.
 *
 * `defaultValue` is part of the public field config and is documented as
 * accepting either a value or `(data) => value`. It was only ever honoured by
 * the admin create form, which fills the value in the browser, and by a
 * single's first-read auto-create. Anything writing through the REST or Direct
 * API therefore stored nothing for an omitted field, and a REQUIRED field
 * carrying a default could not be created at all: validation saw an absent
 * value and rejected the write.
 *
 * Defaults belong on the write path rather than in validation, which reports
 * issues and must not change the data it is given, and rather than as a column
 * DEFAULT, which cannot express a function or reach a JSON-backed value.
 *
 * A collection's fields reach this point from its stored definition, and a
 * function does not survive being stored. So a function default is read from
 * the field-level registry, which captures the function-bearing part of the
 * live code-first config at boot (the same place a field's hooks, access rules
 * and validators come from), and handed in beside the stored fields.
 *
 * @module shared/lib/field-defaults
 */

import { fieldGroupFieldTypes } from "../../domains/field-groups/storage/field-group-field-type";

import type { ValidatableField } from "./entry-validation";

/**
 * The function-bearing part of a code-first field list, by field name, as the
 * field-level registry holds it: a function `defaultValue` for the field
 * itself, and the same shape again for a group's or a repeater's children.
 * Structural rather than imported, so this module does not depend on the
 * registry and the registry's other members stay its own concern.
 */
export type DefaultFunctions = Record<
  string,
  {
    defaultValue?: (data: Record<string, unknown>) => unknown;
    fields?: DefaultFunctions;
  }
>;

/**
 * A field whose value is stored somewhere other than its own column, so a
 * default written here would target a column that does not exist. Field groups
 * qualify in either spelling their stored definition may use.
 */
const NON_COLUMN_TYPES: ReadonlySet<string> = new Set(fieldGroupFieldTypes);

/**
 * Fill in declared defaults for fields the caller did not supply.
 *
 * Mutates `data` in place, because the same object continues on to hooks,
 * validation, and the insert: returning a copy would leave whichever of those
 * still held the original writing the undefaulted value.
 *
 * Only an ABSENT key takes its default. An explicit `null` is a decision the
 * caller made — it is how a JSON body says "no value" — and overwriting it
 * would make a field impossible to leave empty.
 */
export function applyFieldDefaults(
  data: Record<string, unknown>,
  fields: readonly ValidatableField[],
  functions?: DefaultFunctions,
  /**
   * What a FUNCTION default reads, when that is not the record being filled.
   *
   * A function default receives the document built so far, and on a create
   * that document still holds every value the caller sent, including one a
   * field rule denies them. The caller passes a filtered view here so a
   * default cannot read a value its writer was not allowed to send, while the
   * record being filled keeps that value for the authoritative access pass to
   * remove. Filtering the record itself instead would delete the value before
   * the defaults that decide whether it is allowed have run at all.
   *
   * Defaults to the record, which is right wherever there is nothing to hide.
   */
  view?: Record<string, unknown>
): void {
  const readFrom = view ?? data;
  for (const field of fields) {
    // A layout container (row, tabs, collapsible) groups fields visually
    // without holding a value: its children are stored on the parent, so they
    // are filled against the same object.
    if (!field.name) {
      if (field.fields) {
        applyFieldDefaults(data, field.fields, functions, readFrom);
      }
      continue;
    }
    if (NON_COLUMN_TYPES.has(field.type)) continue;

    // The stored definition's constant first; a function only the live config
    // could hold second, since storage dropped it.
    const own = functions?.[field.name];
    const declared =
      (field as { defaultValue?: unknown }).defaultValue ?? own?.defaultValue;
    // Read as an OWN property: a field named after something on
    // `Object.prototype` — `constructor`, `toString`, `valueOf` — would
    // otherwise resolve through the prototype chain, so an empty request body
    // would look as though it supplied an inherited function and the declared
    // default would be skipped in favour of it.
    const supplied = Object.prototype.hasOwnProperty.call(data, field.name)
      ? data[field.name]
      : undefined;
    if (declared !== undefined && supplied === undefined) {
      // Resolved against the data built so far, so a default may read the
      // values the caller did supply, and earlier defaults in this same pass.
      data[field.name] = cloneDefault(
        typeof declared === "function"
          ? (declared as (d: Record<string, unknown>) => unknown)(readFrom)
          : declared
      );
    }

    if (!field.fields) continue;

    // Validation recurses into these, so a child's default has to be filled
    // before it runs or a required child fails on an entry the caller could
    // not have satisfied.
    if (field.type === "group") {
      fillGroup(data, field.name, field.fields, own?.fields, readFrom);
    } else if (field.type === "repeater") {
      fillRepeaterRows(data, field.name, field.fields, own?.fields, readFrom);
    }
  }
}

/**
 * A private copy of a structured default.
 *
 * The declared value lives on the field definition, which outlives every write
 * that reads it, and the same definition fills every repeater row and every
 * entry created from that collection. Assigning it directly would hand all of
 * them one shared object, so a later mutation — a field hook normalizing a
 * row, say — would reach into unrelated rows, entries already written from the
 * same config, and the definition itself.
 */
export function cloneDefault(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    // Only values that cannot be stored at all fail to clone, and those are
    // rejected by validation with a message about the value rather than about
    // the copy that could not be made.
    return value;
  }
}

/**
 * Fill a group's children, creating the group only if something lands in it.
 *
 * An absent group is seeded into a scratch object first: writing `{}` for a
 * group whose children declare no defaults would store an empty object where
 * the caller stored nothing, which is a different value.
 */
function fillGroup(
  data: Record<string, unknown>,
  name: string,
  fields: readonly ValidatableField[],
  functions: DefaultFunctions | undefined,
  /** The parent's view; a child reads the view's matching container. */
  view?: Record<string, unknown>
): void {
  const childView = isPlainObject(view?.[name]) ? view[name] : undefined;
  const existing = Object.prototype.hasOwnProperty.call(data, name)
    ? data[name]
    : undefined;
  if (isPlainObject(existing)) {
    // Filled through a copy: the container came from the caller, and writing
    // child defaults straight into it would mutate the object they passed in.
    // A shallow copy per level is enough, because each level down copies again
    // before it writes.
    const filled = { ...existing };
    applyFieldDefaults(filled, fields, functions, childView);
    data[name] = filled;
    return;
  }
  // A group the caller set to null was cleared deliberately, exactly as for a
  // scalar field, so it is left alone.
  if (existing !== undefined) return;

  const seeded: Record<string, unknown> = {};
  applyFieldDefaults(seeded, fields, functions, childView);
  if (Object.keys(seeded).length > 0) data[name] = seeded;
}

/**
 * Fill each existing row's children.
 *
 * Rows are not invented: how many a new entry starts with is the caller's
 * decision, and `minRows` is a validation rule rather than an instruction to
 * fabricate content.
 */
function fillRepeaterRows(
  data: Record<string, unknown>,
  name: string,
  fields: readonly ValidatableField[],
  functions: DefaultFunctions | undefined,
  /** The parent's view; each row reads the view's row at the same index. */
  view?: Record<string, unknown>
): void {
  const viewRows = Array.isArray(view?.[name]) ? view[name] : undefined;
  const value = data[name];
  if (!Array.isArray(value)) return;
  // Rows are the caller's objects, so each one that gains a default is filled
  // through a copy and the list is rebuilt from the results.
  let changed = false;
  const rows = value.map((row, index) => {
    if (!isPlainObject(row)) return row;
    const filled = { ...row };
    const rowView = viewRows?.[index];
    applyFieldDefaults(
      filled,
      fields,
      functions,
      isPlainObject(rowView) ? rowView : undefined
    );
    changed = true;
    return filled;
  });
  if (changed) data[name] = rows;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A comparable signature of every default a field list declares.
 *
 * Code-first sync decides whether to rewrite stored field definitions from
 * `calculateSchemaHash`, which deliberately excludes `defaultValue` because it
 * may be a function. Defaults are read from those stored definitions on the
 * write path, so without a separate comparison, changing only a default on an
 * existing collection would never reach the database: the entry would keep
 * being created with the previous value until some unrelated change forced a
 * re-sync.
 *
 * A function default is treated as no default at all. It cannot be stored, so
 * the config side would otherwise differ from the stored side forever and
 * re-sync the registry on every boot. The write path reads it from the
 * field-level registry instead, which is filled from the live config on every
 * boot, so there is nothing about it for the stored definitions to carry.
 */
export function fieldDefaultsSignature(
  fields: readonly ValidatableField[] | undefined
): string {
  if (!fields) return "";
  const parts: string[] = [];
  for (const field of fields) {
    const raw = (field as { defaultValue?: unknown }).defaultValue;
    const declared = typeof raw === "function" ? undefined : raw;
    const nested = field.fields ? fieldDefaultsSignature(field.fields) : "";
    if (declared === undefined && nested === "") continue;
    parts.push(`${field.name ?? ""}:${JSON.stringify(declared)}:${nested}`);
  }
  return parts.join("|");
}
