/**
 * A top-level field's name as a list, a condition, a named query's input and
 * a named query's row may write it: letters, digits and underscores, not
 * starting with a digit, with no paths, operators or quoting, and never
 * `__proto__`, which a plain object would not keep as its own key. The one
 * test of it, so what a declaration may name is what a binding can address.
 *
 * @module field-name
 */

/** A field name's spelling. */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether a value is a top-level field name. */
export function isTopLevelFieldName(value: unknown): value is string {
  return (
    typeof value === "string" && FIELD_NAME.test(value) && value !== "__proto__"
  );
}
