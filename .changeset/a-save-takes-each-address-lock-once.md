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

A plugin that takes part in keeping public addresses unique is now handed `saveKey` (`@experimental`) beside `db` and `transaction`: one frozen object for every call core makes about one save or one `ctx.publicAddresses.move`, its `holderOf` calls and the `record` after them, and a new one for the next, even on the same transaction. A participant keeps by it work the question needs only once. It differs from an in-transaction handler's `transactionKey` on purpose: a transaction can roll back to a savepoint between two saves, which on PostgreSQL lets go of row locks taken after it.

The SEO plugin uses it to take each address lock row once per save rather than once per call: a save of a post at `/blog/x` takes 4 lock rows rather than 8 on PostgreSQL and MySQL, and a slug change with its automatic redirect 8 rather than 16. Each lock row taken is a round trip made while the save holds its row locks, so an ordinary save makes four fewer. SQLite takes none and is unchanged.
