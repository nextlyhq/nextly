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
