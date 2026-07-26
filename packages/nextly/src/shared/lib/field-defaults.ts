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
 * KNOWN LIMIT: a collection's fields reach this point from its stored
 * definition, and a function does not survive being stored, so only a constant
 * default can be applied here. A function default is not an error — it is
 * simply absent by the time the write runs, and the field behaves as though
 * none was declared. Honouring it would mean reading the in-memory code-first
 * config on the write path, which is a separate piece of plumbing. A single's
 * first-read auto-create holds the config object directly and does resolve
 * functions.
 *
 * @module shared/lib/field-defaults
 */

import type { ValidatableField } from "./entry-validation";

/**
 * A field whose value is stored somewhere other than its own column, so a
 * default written here would target a column that does not exist.
 */
const NON_COLUMN_TYPES: ReadonlySet<string> = new Set(["component"]);

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
  fields: readonly ValidatableField[]
): void {
  for (const field of fields) {
    if (!field.name) continue;
    if (NON_COLUMN_TYPES.has(field.type)) continue;

    const declared = (field as { defaultValue?: unknown }).defaultValue;
    if (declared === undefined) continue;
    if (data[field.name] !== undefined) continue;

    // Resolved against the data built so far, so a default may read the values
    // the caller did supply, and earlier defaults in this same pass.
    data[field.name] =
      typeof declared === "function"
        ? (declared as (d: Record<string, unknown>) => unknown)(data)
        : declared;
  }
}
