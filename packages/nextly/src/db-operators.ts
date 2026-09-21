/**
 * The Drizzle query operators a plugin needs, exported through core.
 *
 * A plugin that builds a `where` clause needs `eq` and its neighbours. Taking
 * its own `drizzle-orm` dependency to get them is the obvious route and the
 * wrong one: Drizzle identifies tables and columns with internal symbols, and
 * a second copy of the package has different symbols — so a condition built by
 * the plugin silently fails to match the table core handed it. The failure is
 * a query that returns nothing rather than an error, which is the hardest kind
 * to find.
 *
 * Re-exporting from here means every plugin uses core's instance.
 *
 * `sql` is deliberately absent. It is the one operator that takes a raw
 * fragment, and raw SQL from a plugin is what `capabilities.db.rawSql` exists
 * to gate — handing it out through the convenience export would make that gate
 * decorative.
 *
 * @module db-operators
 * @since 1.0.0
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
