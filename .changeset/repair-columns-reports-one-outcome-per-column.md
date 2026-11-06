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

`nextly repair-columns` now gives every column it reports one outcome from a documented list (not migrated, pending a migration, owned by a plugin, blocked, needs consent, would convert, and the outcomes a later apply adds), and exits with a code CI can read: 0 when no difference remains, 2 when differences remain, 3 when a conversion failed or was interrupted, and 1 when it could not run. `--json` writes one versioned document (`nextly.repair-columns/1`) to standard output with every column, its outcome and the same facts as the text report, where a fact that does not exist is `null`. The report shows each conversion's statements, whether it rewrites the table and how many rows, what the database blocks while it runs, and what the owner can change for a blocked column. It still reports while another schema change holds the schema lock, says so and names the holder, and never takes the lock itself.
