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

A collection something depends on can no longer be deleted. While a field of another collection, a Single or a field group points at it, a foreign key a plugin or the app declares points at its table, or a plugin or the app has added a column, index, foreign key or check to one of its tables, the Schema Builder's delete, the schema API, `nextly prune --force` and `migrate:create` refuse before anything is removed, naming each with its owner and table and saying what to do. Where those cannot be read the delete is refused rather than going ahead. A Builder bulk delete is now one request checked as a whole, so collections that point only at one another can be deleted together; deleting each alone is refused. A Builder delete that fails part-way, of one collection or several, now removes nothing on PostgreSQL and SQLite: their field-group values, translations, tables and registry rows go in one transaction, and the drop migration written for it is withdrawn. On MySQL, which keeps each table drop as it runs, every collection not yet deleted stays registered and the message says to delete again to finish.
