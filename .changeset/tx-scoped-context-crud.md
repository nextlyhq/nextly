---
"nextly": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/ui": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"create-nextly-app": patch
---

Run a transaction's `select`/`selectOne`/`update`/`delete`/`upsert` inside the transaction.

The `TransactionContext` CRUD methods delegated to the adapter's pool-bound Drizzle instance, so on the pooled adapters (Postgres, MySQL) a read inside a transaction ran on a different connection and could not see rows written earlier in the same uncommitted transaction. Two same-title creates in one transaction (or bulk batch) both chose the base slug and the second hit the unique constraint instead of receiving `-2`. The base CRUD methods now accept an optional transaction-bound executor, and each dialect binds a Drizzle instance to its checked-out connection so context CRUD reads its own writes. SQLite was already correct by virtue of being single-connection; the fix makes all three dialects consistent.
