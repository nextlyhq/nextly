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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
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
---

On PostgreSQL, Nextly reads a database's current shape to work out what a
migration should change. Those reads looked in a schema called `public`, while
every statement Nextly writes is unqualified and lands wherever the connection's
`search_path` points. On a deployment that uses its own schema — one per tenant,
or just a house convention — the two disagreed.

The reads now resolve a table the same way the writes do, quoting the name first
so one whose spelling carries capitals — which a custom table name may — resolves
to itself rather than to nothing. Nothing changes for a database that uses
`public`, which is the default.

What it fixes on the others: columns that exist read as absent, so a migration
offered to add what was already there; and where a table of the same name existed
in `public`, its shape answered for the real one — comparing against a table
nothing writes to.
