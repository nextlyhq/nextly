/**
 * Rules about a field, or a pair of sibling fields, that the server and the
 * Builder both apply: whether two names clash, and whether a field's column is
 * unique. One implementation, so the Builder refuses a move by the very rule a
 * save refuses it by, rather than by a copy that could come to disagree.
 *
 * Browser-safe on purpose: it imports nothing at run time, so `nextly/config`
 * can offer it to the admin. The server's own modules (sibling-fields, the
 * column descriptor, the dynamic-collection schema service) import from here.
 *
 * @module domains/schema/field-rules
 */
/** Why two sibling fields clash, in the order the rule asks. */
export type SiblingClashKind =
  | "same-name"
  | "same-name-ignoring-case"
  | "same-column";

/**
 * The column a field's name becomes: `fooBar` and `foo_bar` both `foo_bar`.
 * The column descriptor, field-to-column mapping's home, re-exports it.
 */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

/**
 * Whether two sibling names clash, and why: the same name, names that differ
 * only in letter case, or names that become the same column. The column is
 * what the database refuses, and MySQL and SQLite compare column names without
 * regard to case, so all three are asked.
 *
 * @experimental Published for the Builder's move and copy rules.
 */
export function siblingNameClash(
  a: string,
  b: string
): SiblingClashKind | null {
  if (a === b) return "same-name";
  if (a.toLowerCase() === b.toLowerCase()) return "same-name-ignoring-case";
  if (toSnakeCase(a) === toSnakeCase(b)) return "same-column";
  return null;
}

/**
 * Whether a Builder field's column is unique.
 *
 * A one-to-one relationship is unique by its cardinality, not by anything the author ticks, so
 * the flag alone does not decide it. Asked in one place because the answer has to be the same
 * whether the column arrives with its table or is added to one that already exists (a table
 * that gained its one-to-one by an edit was not enforcing the cardinality it declared), and
 * whether a later save keeps the constraint its table holds.
 *
 * @experimental Published for the Builder's move rule, which refuses moving such a field into a
 * group or repeating rows.
 */
export function builderColumnIsUnique(field: {
  readonly type?: unknown;
  readonly unique?: unknown;
  readonly options?: unknown;
}): boolean {
  if (field.unique === true) return true;
  if (field.type !== "relationship") return false;
  // Read as given: a relationship's options are an object, other fields'
  // a list of choices or nothing, and only the object can say one-to-one.
  const options = field.options as { relationType?: unknown } | undefined;
  return options?.relationType === "oneToOne";
}
