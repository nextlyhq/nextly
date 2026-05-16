---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Collection mutation paths now resolve the physical table through `collection.tableName`, honoring `dbName` overrides instead of always deriving the name from the slug. The code-first boot sync detects when a collection's resolved `tableName` differs from the row in `dynamic_collections`, renames the physical table (Postgres/SQLite/MySQL quoted `ALTER TABLE ... RENAME TO`), writes the new name back, and invalidates the cached Drizzle schema in `CollectionFileManager` so the next request rebuilds against the renamed table — previously a `dbName` change left CRUD pointing at the stale table until a server restart. When both the old and new physical tables exist, the rename is skipped with a warn so the user can resolve the conflict manually. Component runtime-schema refresh after a UI-driven create/update/apply now flows through the DI `SchemaRegistry` (with a typed fallback to the adapter's `tableResolver` for non-DI paths) and surfaces failures as warnings instead of swallowing them in a silent try/catch — the prior behavior left `comp_*` queries selecting pre-rename column names until restart. Generated timestamp columns (`createdAt`, `updatedAt`) now emit `withTimezone: false` / plain `TIMESTAMP` for Postgres, aligning behavior across SQLite, MySQL, and Postgres.
