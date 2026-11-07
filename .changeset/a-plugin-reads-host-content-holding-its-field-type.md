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

A plugin can read host content that uses its field type inside a transaction
it holds: `ctx.services.ownCollections` gains `listHostEntriesInTransaction`,
`findHostEntryByIdInTransaction` and `getHostSingleInTransaction`
(experimental). They read a collection or Single the plugin did not declare,
only when it holds a field of a type the plugin registered, at any depth
(groups, repeaters, components), decided at each call from the schema as it
stands. They read as the own in-transaction reads do: on the transaction's
connection, as the system, past that content's read hooks, with rows locked
for share or, with `lock: "update"`, for update. Anything else is refused
before its rows are read.
