---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Fixed component data teardown resolving table names case-insensitively on every database. On PostgreSQL, and on MySQL with `lower_case_table_names=0`, two names differing only in case are two different tables, so a registered component whose stored name differed in case from a real table could have that other table's rows deleted. Whether two spellings mean one table is now read from the server rather than assumed, including that SQLite folds ASCII case only, so `Ä` and `ä` stay distinct tables there.

Also more groundwork for the upcoming field group storage migration: the rename plan is now checked against what the database actually contains before anything runs, so a name already in use, a registry row whose storage or companion table is missing, or a half-applied rename that recorded progress cannot account for all refuse up front instead of failing partway through. That part is not called by anything yet.
