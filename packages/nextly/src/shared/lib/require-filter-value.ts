/**
 * Refuse a single-key lookup whose filter value is empty.
 *
 * Drizzle v1's relational-query object filters silently DROP keys whose value
 * is `undefined` (`drizzle-orm/relations.js` skips them). So
 * `findFirst({ where: { id: undefined } })` compiles to a query with NO WHERE
 * CLAUSE and returns an arbitrary row — the first one in the table. The older
 * callback form (`eq(col, undefined)`) bound a parameter and matched zero rows;
 * it failed safe. This is that flip, and it fails open.
 *
 * Measured rather than reasoned about: with two permissions seeded,
 * `getPermissionById(undefined)` returned `Read Posts` instead of raising
 * NOT_FOUND. On a lookup reached from a route parameter that is an
 * authorization bypass — an absent id hands back somebody's record, and it
 * defeats the deliberate practice of answering a hidden resource with NOT_FOUND
 * rather than FORBIDDEN so the policy is not leaked.
 *
 * A nullish or empty filter value is a programming error upstream. It must
 * throw rather than widen the query.
 *
 * @param value - The resolved filter value.
 * @param field - Column name, recorded for operators; never echoed publicly.
 * @throws NextlyError(INTERNAL_ERROR) when the value cannot filter.
 *
 * @module shared/lib/require-filter-value
 */
import { NextlyError } from "../../errors/nextly-error";

export function requireFilterValue<T>(value: T, field: string): NonNullable<T> {
  if (value === undefined || value === null || value === "") {
    throw NextlyError.internal({
      logContext: {
        reason:
          `query filter "${field}" resolved to an empty value — ` +
          `refusing to run an unfiltered lookup`,
      },
    });
  }
  return value;
}
