/**
 * Which repeaters get a saved row id: every repeater whose rows don't declare
 * a field named `id` of their own. One rule for the server, which gives the
 * ids, the type generators, which describe them, and the admin, which gives
 * a new row one. Pure, so the admin reads it through `nextly/field-catalog`.
 *
 * @module collections/fields/repeater-row-identity
 */

/**
 * Whether a repeater's rows declare a field named `id`, on the row itself or
 * through a layout container, which keeps its fields on the row. Such a
 * row's `id` is the author's, so the system gives the row none. Read from
 * fields as configured, typed or not, so config validation asks it too.
 */
export function declaresOwnId(fields: readonly unknown[]): boolean {
  return fields.some(field => {
    if (typeof field !== "object" || field === null || Array.isArray(field)) {
      return false;
    }
    const { name, fields: inner } = field as {
      name?: unknown;
      fields?: unknown;
    };
    if (typeof name === "string" && name !== "") return name === "id";
    return Array.isArray(inner) && declaresOwnId(inner);
  });
}
