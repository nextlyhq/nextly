/**
 * @experimental Query operators for plugin code.
 *
 * Re-exported from core rather than from `drizzle-orm` directly, so every
 * plugin builds its conditions with the Drizzle version core runs, and the SDK
 * needs no `drizzle-orm` dependency of its own.
 *
 * Named one by one rather than re-exported with `*`, so an operator added to
 * core does not become public SDK surface without a change here, a surface
 * snapshot change and a stability row.
 *
 * `sql` is left out: a plugin that runs raw SQL declares
 * `capabilities.db.rawSql`, which a reviewer reads.
 *
 * @module db
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
} from "nextly/db-operators";
