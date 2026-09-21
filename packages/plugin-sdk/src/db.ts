/**
 * Query operators for plugin code.
 *
 * Re-exported from core rather than from `drizzle-orm` directly, so every
 * plugin shares the instance core builds its tables with. Drizzle identifies
 * tables and columns by internal symbols, and a second copy of the package has
 * different ones — a condition built with those matches nothing, and does so
 * quietly.
 *
 * The SDK therefore needs no `drizzle-orm` dependency of its own.
 *
 * `sql` is not here on purpose: raw SQL is what `capabilities.db.rawSql`
 * gates, and a convenience export would route around it.
 *
 * @module db
 */
export * from "nextly/db-operators";
