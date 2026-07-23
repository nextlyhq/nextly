---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Fix entry-saving and migration table-naming issues.

- Optional fields (email, length-limited text, multi-select, and similar) no longer block saving an entry when left blank — their validators now run only on a typed value.
- Multi-value (`hasMany`) select fields now render as a real multi-select and can be saved from the admin, instead of being rejected as "expected array, received string".
- `nextly migrate:create` and `migrate:check` now name plugin collection tables with the same `dc_` prefix the runtime uses (for example `dc_forms`), so generated migrations match the live database.
- Number fields inside a component now use the same column type as number fields in collections — integer by default, an exact decimal for `dbType: "decimal"` — instead of always being stored as a floating-point column.
- On SQLite, changing a column between numeric types (for example real to integer) no longer reports a false "data loss" warning; values are preserved, and cross-type changes such as text to integer still warn.
- An optional field left blank is now saved as an empty (`NULL`) value rather than an empty string, so an optional unique field no longer rejects the second entry that leaves it blank. Password fields are exempt: a blank password still means "keep the current one".
- A multi-value select declared with an array default (`defaultValue: ["web", "retail"]`) now starts with those options selected, instead of rendering one unusable entry and failing validation. Multi-value selects on singles now start empty rather than invalid.
- Saving a collection in the Schema Builder no longer alters tables defined in `nextly.config.ts` or contributed by a plugin. Those tables are owned by your config and are reconciled from it, so a visual edit can only change the entity you are editing — on SQLite and MySQL as well as PostgreSQL.
- Float number fields in a component now use the same PostgreSQL column type (`double precision`) as the runtime and generated schema, instead of `real`, which left the table permanently out of sync with the desired schema.
- Changing a component number field's storage (`dbType`, `precision` or `scale`) now alters the column instead of being treated as no change and leaving the old type in place.
- A component declaring a custom `dbName` is no longer queued for a redundant table sync on every startup.
