/**
 * The hook context that tells the forms collection's `afterRead` hook a read
 * wants the forms themselves and nothing only a display needs, so it skips
 * the submission count it would otherwise run per form: a write checking a
 * submission against its form, and the dashboard card scanning which forms a
 * reader may read, need the count no more than they need a second copy of
 * the form.
 *
 * @module utils/schema-only-read
 */

/** The context key the forms `afterRead` hook reads; `true` skips the count. */
export const SCHEMA_ONLY_READ = "formBuilder.schemaOnlyRead";

/** The context a schema-only read hands the forms collection's hooks. */
export const SCHEMA_ONLY_CONTEXT: Readonly<Record<string, unknown>> = {
  [SCHEMA_ONLY_READ]: true,
};
