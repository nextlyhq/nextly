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

Every reader of the migrations folder now reads a dialect's variant (`0003_seed.mysql.sql`) together with its migration, as the runner does.

- A migration states that it is blank, and its place in the history, once. A variant that states nothing follows its base file, so `nextly migrate:check` passes a hand-written variant beside a `migrate:create --blank` file. A blank mark that only a variant carries marks the whole migration.
- A `-- Parent:` line stated only in a variant now places the migration in the history.
- When a base file and a variant state different places, `nextly migrate`, `nextly migrate:create`, `nextly migrate:check` and a Schema Builder save refuse, naming both files. This is the new `MIGRATION_PLACE_STATED_TWICE` code.
- Settling a Builder save that was left part-way names a later blank migration once, by its own name, and no longer reads a variant of a migration that has a snapshot as a blank migration of its own.
- `nextly migrate:check`'s statement check judges a variant against its migration's snapshot, so the next file's DESTRUCTIVE warnings are judged against the right schema.
