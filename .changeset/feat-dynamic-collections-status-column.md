---
"@revnixhq/nextly": patch
---

Add the `status` column to the runtime `dynamicCollections` Drizzle table
descriptor for postgres, mysql, and sqlite. The canonical schemas under
`packages/nextly/src/schemas/dynamic-collections/{dialect}.ts` already
declared this column, but the duplicate runtime descriptors at
`packages/nextly/src/database/schema/{dialect}.ts` (which `getDialectTables()`
exports) did not. As a result, Drizzle's generated `SELECT` statements
silently dropped `status` from query results — the API never surfaced the
Draft/Published flag even when the database column was set. This patch aligns
the runtime descriptor with the actual database schema; full unification of
the duplicate declarations remains a deferred refactor.
