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

A plugin can read its own content inside a transaction it holds:
`ctx.services.ownCollections` gains `listEntriesInTransaction`,
`findEntryByIdInTransaction` and `getSingleInTransaction` (experimental).
They take the token `collections.withTransaction` hands its work, or an
in-transaction handler's `transaction`, and read on that transaction's own
connection, so they see its uncommitted writes and no longer wait for a
second connection on a pool of one. On PostgreSQL and MySQL the rows they
read are locked for share until the transaction ends; a list's total is not.
`getSingleInTransaction` reads a Single the plugin declared, past its read
hooks, and writes nothing. The adapter's `select` takes `forShare`.
