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

The SEO plugin's address record moves from a collection to its own tables,
`seo__addresses` and `seo__notes`, written on the save's transaction with
`ctx.db`. Each claim, release and lock row is now one statement rather than a
whole entry save, so an entry save on PostgreSQL issues about a tenth of the
address bookkeeping it did. Run `nextly migrate` to create the tables; the
first start afterwards moves the rows an earlier version kept, before the
plugin answers any save, and leaves the old collection in place, unused.

`ctx.db.select(...).lock("update" | "share")` (experimental) reads rows
`FOR UPDATE` or `FOR SHARE` inside a transaction, which on MySQL also reads
the latest committed rows rather than the transaction's snapshot. A public
address participant's deadlock is reported as a conflict to try again, as
core reports its own.
