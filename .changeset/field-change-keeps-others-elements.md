---
"nextly": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

A field change that keeps its entity but removes one of its columns or tables is refused before anything runs where another owner built on it: a plugin's index or foreign key on a removed column, or anything on a removed table, such as a many-to-many's join table. This covers removing a field, moving it into a group, and turning translation on where that moves the column, through a Schema Builder save and a development push. The refusal names the field, the owner, the element and its table. Before, PostgreSQL dropped such an index silently, MySQL dropped or narrowed it, and SQLite failed part-way. A record of other owners' elements that cannot be read refuses the change. A Builder save of a table a plugin migration built on is no longer refused as drift.
