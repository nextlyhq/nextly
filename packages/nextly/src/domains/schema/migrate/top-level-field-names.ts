/**
 * The top-level field names of a field list, as a record, a snapshot or a
 * registry row holds it. One reading, so a row judged against a migration
 * and a row judged against the build name the same fields.
 *
 * @module domains/schema/migrate/top-level-field-names
 */

/** The names of the fields in `fields`; none where it is not a list. */
export function topLevelFieldNames(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap(field => {
    const name =
      typeof field === "object" && field !== null
        ? (field as { name?: unknown }).name
        : undefined;
    return typeof name === "string" && name !== "" ? [name] : [];
  });
}
