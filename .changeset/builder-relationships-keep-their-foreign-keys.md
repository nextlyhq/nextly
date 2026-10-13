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
---

A Schema Builder collection keeps its foreign keys, and gets the key of a
relationship added to it.

The Builder creates a collection's table with each relationship's key, but
every later save went through the schema push, which described no keys. So a
relationship added to an existing collection got no key on any database. On
SQLite, where a key lives only in the table's definition, a save that changed
a field's type rebuilt the table without its key, and a save that rebuilt a
collection other collections point at failed outright. A save now adds the key
of a relationship it adds, and keeps every key a table already holds through a
rebuild, with no delete action running during it. A relationship that was
added before this and has no key is left as it is.
