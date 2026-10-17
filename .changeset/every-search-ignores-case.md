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

Every case-insensitive text search now ignores case on PostgreSQL, MySQL and SQLite,
even under a case-sensitive collation, and matches what was typed literally: a collection's
`contains` and `search` filters, its search box, and the admin's search of collections, Singles
and field groups. On MySQL these followed the column's collation, so under `utf8mb4_bin` they
were case-sensitive; on SQLite a typed `%` or `_` never matched; and the admin's search read a
typed `%` or `_` as a wildcard. They now all use one rule, published as
`caseInsensitiveContains` from `@nextlyhq/adapter-drizzle/text-match` (experimental).
