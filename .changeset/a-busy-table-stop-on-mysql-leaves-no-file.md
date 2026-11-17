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

On MySQL, a Schema Builder save of a Single or a field group that waited for a busy table and stopped before anything ran now leaves no migration file, snapshot or definition behind, as on PostgreSQL and SQLite. It used to keep them, so the next `nextly migrate` applied a change the person was told had not happened. A save that stopped part way still keeps its files, recorded applied nowhere. An untranslated collection's schema-dialog save now keeps the development push when it changes a field's column type, where the push judges the stored values first, and otherwise runs its own migration file as before. A refusal of a field group's field made required over entries that hold no value names the collections and Singles holding them in one order on every road and database: collections first, then Singles, each by slug.
