---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

`nextly migrate` records a pending migration as applied without running it only when its snapshot proves the whole file. More of what a database brought to the file's end by hand can hold under the file's own names is now checked, and the file is refused with `NEXTLY_MIGRATION_NOT_PROVEN` where one fails:

- a constraint the file validates (`VALIDATE CONSTRAINT`) must be validated in the database;
- on MySQL, a check must be enforced as the file declares it, and a column flag the proof does not know (HeatWave's `NOT SECONDARY`, for example) counts as a setting a `MODIFY` would reset;
- on PostgreSQL, a foreign key must have the deferrability the file declares;
- an index must be built by the default method, and an index statement that states a direction, a NULL order or a method is not shown by the snapshot;
- on SQLite, a table whose `AUTOINCREMENT` counter a rebuild carries must be declared `AUTOINCREMENT`, with a counter at least its highest key, or no counter and no rows;
- on SQLite, a foreign key replaced under its own name by one of another shape counts as a key the file adds, so rows dangling through it refuse the file.
