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

A migration file, plugin module or down migration that commits part-way through is refused before anything runs, naming the statement. Its own `BEGIN`, `START TRANSACTION`, `COMMIT` or `END` used to be dropped silently, so a file written to commit its first half on its own ran as one transaction instead. A file wrapped whole in one `BEGIN` ... `COMMIT` still runs as before: the runner's transaction already wraps it.

To upgrade: a pending file with a `COMMIT` or `BEGIN` part-way through is refused until it is split there into two files, or marked with `-- nextly:no-transaction` as its first line (and its `BEGIN` and `COMMIT` removed), which runs it statement by statement.
