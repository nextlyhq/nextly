/**
 * The Drizzle query operators a plugin needs, exported through core.
 *
 * A plugin that builds a `where` clause needs `eq` and its neighbours.
 * Re-exporting them keeps every plugin on the Drizzle version core runs, so a
 * plugin needs no `drizzle-orm` dependency of its own to drift from it.
 *
 * `sql` is left out. It is the one operator that takes a raw fragment, and a
 * plugin that runs raw SQL says so with `capabilities.db.rawSql`, which is
 * what a reviewer reads. That is a declaration, not an enforced boundary: a
 * plugin is trusted code and can still build raw SQL with its own copy of
 * `sql`.
 *
 * @module db-operators
 */
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  or,
} from "drizzle-orm";
