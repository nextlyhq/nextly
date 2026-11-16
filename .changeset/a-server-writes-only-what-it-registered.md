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

A running server no longer writes to a collection, Single or field group it has not registered — one a newer deploy added or changed after it started. A collection create (single, in a caller's transaction, or batched), a field group's instances, and in production a Single's update are refused with the not-registered answer (`ENTITY_NOT_MIGRATED`, 409, naming `nextly migrate` and a restart) and write no row. Before, the create and the field-group save still wrote, and an update of a field group whose table was unregistered could add a second instance beside the stored one. In development a Single is still recovered on a read or a write, as a second dev worker needs. The CLI commands that take the schema lock (`migrate:resolve`, `migrate:baseline`, `migrate:down`, `upgrade`, plugin install and uninstall) keep working on a database whose lock row is not yet seeded.

**Compatibility:** an adapter used without a table registry (no `setTableResolver`) now refuses transaction inserts, as it already refused transaction updates, deletes, selects and upserts — inserts were the one write that still went through, so this makes them consistent rather than adding a new refusal. Code that builds its own adapter and calls the schema-lock APIs must install a registry resolver first (for example `installRegistryResolver`, which the CLI now does for every command).
