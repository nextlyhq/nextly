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

One response per person is held by the database. A form that takes one response per network (IP address), or per email address with a chosen Email field (compared ignoring case), stores a keyed one-way digest beside each non-spam submission, never a second copy of the address. A unique index on the form and the digest refuses a second submission with the same value, even when several arrive at once. The digest is made by the plugin wherever a submission is written, and is never taken from the caller. A form that allowed one submission per IP before this change still refuses a network that submitted then.

Existing installations receive the new `responseKey` column and its unique index on the submissions collection through their own migrations: run `nextly migrate:create` and then `nextly migrate` (or `nextly db:sync` in development).
