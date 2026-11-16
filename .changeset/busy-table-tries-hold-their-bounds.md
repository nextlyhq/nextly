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

A schema change that waits for a busy table now keeps its bounds, and retries only what is safe to send again:

- On PostgreSQL, a database with a DDL event trigger that no installed extension owns stops a schema change after one try rather than run the trigger's code again. A migration that sets `search_path` is judged against the triggers of every schema.
- A function called with numbers in a schema statement, such as a default's `site_fn(1)`, counts as code the system does not know. A column's sized type and a MySQL index prefix length do not.
- On MySQL, the statements after a schema statement's implicit commit run in a transaction again, so a retry sends them once. A wait in a statement's required-column check no longer counts the transaction before it as committed. A try that kept nothing is reported as undone.
- The ledger write after a migration, and the record of a stopped one, wait for the ledger table no longer than the try allows. On SQLite, a migration's own `PRAGMA busy_timeout` cannot lift the bound, and the ledger writes after a migration run outside a transaction roll back together.
- The watch that ends a long wait opens its own connection when the pool has none free.
- A Builder collection delete with an invalid `NEXTLY_LOCK_TIMEOUT` is refused before it removes anything.
- A `migrate:down` stop names the files rolled back before it as rolled back.
