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

A Schema Builder save that removes a field holding values can now carry the counts the person confirmed in the review (`confirmedDeletions` on the apply). The save counts the values again inside the migration file's own transaction, just before the statement that drops them, and deletes only where every count still matches. On PostgreSQL other sessions' writes to the table wait from that count until the save has committed, while reads go on; SQLite's transaction already holds its one write lock. A count that changed deletes nothing and is refused, naming the field and its new count. A save sent without counts deletes as before. On MySQL, whose schema statements commit on their own, the count is compared just before the statements, without holding other writes. A save the push applies instead of its file (a translated collection in development) is compared the same way, just before the push. Only fields stored in a column are compared: a removed many-to-many relationship deletes as before.
