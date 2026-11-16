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

Two new core tables hold what each reader's dashboard keeps for them. They are additive, created by
`nextly migrate`, and by boot where boot applies the core schema. Run `nextly migrate` to create
them on an existing site.

- `nextly_dashboard_pins`: one row per reader per pinned entry or Single (`user_id`, `target_type`,
  `target_slug`, `entry_id`, `pinned_at`), unique on the reader and the target. A Single's
  `entry_id` is empty rather than NULL, so the unique index holds the same on PostgreSQL, MySQL
  and SQLite.
- `nextly_dashboard_preferences`: one short value (at most 255 characters) per reader per key
  (`user_id`, `preference_key`, `value`, `updated_at`), unique on the reader and the key.
- A reader's rows in both are deleted with the reader.
- Until the tables exist, a reader has no pins and every preference reads as unset; pinning is
  refused with a message naming `nextly migrate`. Nothing reads or writes them yet: the dashboard's
  pins and remembered choices are built on them next.
