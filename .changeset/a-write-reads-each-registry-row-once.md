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

A write no longer reads the same registry rows again and again inside its transaction. Each collection's registry row is read from the database once per transaction and then answered from that transaction's own memo, which a registry or schema write in the same transaction, or a rollback to a savepoint, makes it read again; no other transaction ever sees it. An entry update that read `dynamic_collections` ten times now reads each collection once.

Two start-up costs go too. A retention pass offered while its marker is current is now refused by one read, where it deleted nothing and then sent an insert the primary key refused, a failed statement in the database log for every pass each process offered. And a boot settles every email template's engine from one read of the engine marks, where each template read the meta table twice.

`DrizzleAdapter` gains an experimental `transactionInFlow()`, which names the open transaction the calling flow runs in and says whether its part has rolled back to a savepoint.
