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

The checks in front of the version, preview, content-event and release routes now answer `ENTITY_NOT_MIGRATED` (409) when the database lacks an entity's table or a declared field's column. Before, they answered a 500. Those checks are reading a Single's document id, judging whether a document may be read or updated, the release readiness reads, and the legacy batch writes. A table name holding a space, a dot or a dash is also now recognised whole in the database's error.

**Compatibility:** a legacy batch write (`createMany`, `updateMany`, `createEntries`, `updateEntries`, `deleteEntries` and their transaction versions) now stops at the first item the database is not migrated for (for the batch's own collection), whatever `stopOnError` says. A batch that runs its own transaction rolls it back whole and reports that answer on every item; a transaction version throws that answer, and the caller's transaction decides what it keeps. Before, whether its other items were saved depended on the database and on which columns each item's write named. Each item in a batch's `errors` also now carries the error `code` of its own failure. A transaction version with `stopOnError` now throws that item's own error (such as 409 or 404) instead of a generic 500.
