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

Fix fresh-database first-run aborting on MySQL.

Now that `nextly_schema_events` is a core table, `freshPushSchema` creates it (and its indexes) during first-run setup. The setup then also replayed the out-of-band `getSchemaEventsDdl` unconditionally, and the MySQL raw DDL's `CREATE INDEX` has no `IF NOT EXISTS`, so it failed with a duplicate-index error and first-run reported failure on a fresh MySQL database. The out-of-band bootstrap is now guarded by a `tableExists` check (matching `nextly migrate`'s `ensureLedger`), so it only runs as a fallback when the ledger is genuinely missing.
