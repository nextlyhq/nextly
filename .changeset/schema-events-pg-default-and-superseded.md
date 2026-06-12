---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/ui": patch
---

Fix two `nextly_schema_events` ledger edge cases on the code-first schema path.

- **Postgres index/default churn:** the ledger's raw bootstrap DDL declared `started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, but the Drizzle def supplies the value app-side (`$defaultFn`) with no SQL default. Now that the ledger is a core table flowing through drizzle-kit's Postgres diff, that mismatch made every push/migrate emit `ALTER COLUMN started_at DROP DEFAULT`. The raw DDL now omits the redundant default (matching the MySQL/SQLite ledger DDL and the `id` column), so the ledger round-trips cleanly with no churn. Added a Postgres round-trip integration test alongside the existing SQLite one.
- **`markApplied` race no-op:** when the "one applied row per file" guard blocked a concurrent second apply, the losing row was left dangling at `in_progress` and the caller still logged a success. `markApplied` now resolves the blocked row to `superseded` and returns whether it applied, and `nextly migrate` reports the file as already-applied-by-a-concurrent-run instead of a false success.
