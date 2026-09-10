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

`nextly migrate:fresh` empties the database and rebuilds it. On PostgreSQL it
asked for the list of tables to drop from a schema called `public`, but the
`DROP` it then issues names no schema at all, so it goes wherever the
connection's `search_path` points.

On an installation that keeps Nextly in its own schema those two disagreed, in
both directions at once: Nextly's own tables were never listed, so they survived
the reset — and whatever else happened to be in `public` was listed, and dropped.

Discovery now asks for the schema the drop will actually reach. Nothing changes
for a database that uses `public`, which is the default.
