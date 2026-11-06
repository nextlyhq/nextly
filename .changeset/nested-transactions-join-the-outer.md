---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

On PostgreSQL and MySQL, a transaction opened inside another transaction's work now joins it, as it already did on SQLite, instead of taking a second connection. Before, such a nested transaction could not see the outer one's uncommitted writes, committed on its own, and could wait forever on a row the outer had locked. This covers the adapter's `transaction()`, the Drizzle handle's `transaction`, and Drizzle's own `tx.transaction`. On PostgreSQL a joined call runs as a savepoint, so its failure undoes only its own part. On MySQL a joined call shares the outer's statements, so its failure fails the whole transaction, even when the outer catches it.

What this changes for code that nests transactions on PostgreSQL and MySQL:

- `afterCommit` now holds an effect until the outermost transaction commits, on every dialect, and drops it when that transaction rolls back.
- `inTransaction()` can now answer true.

New, and experimental:

- `afterRollback(effect)` runs an effect once the outermost transaction has rolled back for good. A retried attempt's effects are dropped with it.
- `TransactionOptions.retryWhen` lets a caller retry an outermost transaction for an error of its own choosing, application errors included.
- SQLite now honours `retryCount` when `retryWhen` accepts the error.
