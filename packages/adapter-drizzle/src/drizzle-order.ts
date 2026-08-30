import { asc, desc, sql } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";

import type { OrderBySpec } from "./types";

/**
 * Turn order specifications into drizzle order clauses.
 *
 * Extracted from `DrizzleAdapter.select` so the rendered SQL can be asserted
 * directly. That matters more than it looks: `OrderBySpec.nulls` was declared,
 * documented as "can be explicitly controlled", and read NOWHERE — every caller
 * that set it silently got the dialect default instead, and no test could have
 * caught that while the mapping lived inline in a method that needs a database.
 *
 * ## Why null placement is a leading sort key, not `NULLS FIRST/LAST`
 *
 * That clause is not portable: PostgreSQL and SQLite accept it, MySQL does not.
 * `col IS NULL` is a boolean expression all three evaluate, and sorting on it
 * ascending puts non-null rows first — which is `NULLS LAST` by another name,
 * spelled in something every supported engine understands.
 *
 * The defaults genuinely disagree, which is why the control exists at all:
 * PostgreSQL treats NULL as largest and puts it FIRST on a descending order,
 * while MySQL and SQLite treat it as smallest and put it last. A "newest
 * scheduled first" list containing undated drafts therefore returns different
 * rows per engine, and under a limit it can return only drafts.
 */
export function buildDrizzleOrderBy(
  columns: Record<string, AnyColumn>,
  orderBy: OrderBySpec[] | undefined
): SQL[] {
  if (!orderBy?.length) return [];

  return orderBy.flatMap((spec): SQL[] => {
    const col = columns[spec.column];
    // An unknown column is skipped rather than thrown on: ordering is a
    // refinement, and a caller naming a column that is not there should get an
    // unordered answer rather than a failed query.
    if (!col) return [];

    const direction = spec.direction === "desc" ? desc(col) : asc(col);
    if (spec.nulls === undefined) return [direction];

    const isNull = sql`${col} is null`;
    return [spec.nulls === "last" ? asc(isNull) : desc(isNull), direction];
  });
}
