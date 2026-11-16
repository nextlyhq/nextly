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

A user's deletion asks whether a required Schema Builder relationship still points at the account inside the deletion's own transaction. Inside a transaction the caller already holds, such as a plugin's `ctx.db.transaction`, the question now sees what that transaction wrote: deleting the entries that pointed at a user and then the user in one transaction succeeds on PostgreSQL and MySQL, where it was refused as still referenced. The question's reads run on the transaction's connection rather than a second one from the pool.

A user's deletion inside such a transaction also removes the account's recovery points, and sweeps its audit, activity and delivery records a second time, only once that transaction commits, and not at all when it rolls back. Before, those sweeps ran as the deletion returned, on another connection: one rolled back with the transaction still removed the person's unsaved drafts, and on MySQL the deletion waited on rows the transaction itself held until the lock wait timed out.
