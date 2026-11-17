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

`nextly db:sync` now refuses in production before it opens the database. With `NODE_ENV=production` it used to create the core tables, write the registry rows, create Single and field-group tables and seed permissions, and refuse only when a collection had changed, sometimes leaving the schema lock held. It now refuses at once in every mode (`--no-auto-sync`, `--promote` and `--demote` included), changes nothing, and names `nextly migrate:create` and `nextly migrate` as the way to change a production schema. `nextly db:sync --dry-run` still runs there and names the refusal. A development reload reached with `NODE_ENV=production` is skipped the same way, with one warning. Only `NODE_ENV=production` counts: a sync with it unset or set to anything else runs as before.

On SQLite, a `db:sync` refused because another process holds the schema lock no longer adds the core tables and indexes the database lacks before it is refused.
