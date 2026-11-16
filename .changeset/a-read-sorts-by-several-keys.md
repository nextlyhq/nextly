---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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

A collection read sorts by several keys and starts at any offset. `sort` takes
an array or a comma-separated string (`["-featured", "createdAt"]`,
`?sort=-featured,createdAt`), and `find` takes `offset` (a whole number from 0,
refused together with `page`), with `hasNext` and `hasPrev` following it.

Two behaviour changes for sorted reads: entries tied on every sort key now come
back in id order, so a page never shifts between reads; and an entry with no
value for a key now sorts last in both directions on every database. Empty
values move in a descending sort on PostgreSQL and in an ascending sort on
MySQL and SQLite, which each put them first there before. A read with no sort and
no offset is unchanged. Sorting a field held per language with fallback off
now works on SQLite.
