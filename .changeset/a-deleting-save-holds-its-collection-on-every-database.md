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

A Schema Builder save that deletes a field's values now holds its collection on PostgreSQL and SQLite as it does on MySQL, from its count of those values until its registry row records the new definition, whether its migration file or the push applies it: an entry write made meanwhile waits for the save, then meets the definition it recorded. A write that sets a field the save removed, or one it keeps but stores differently, is refused naming the field (`VALIDATION_ERROR`, issue code `FIELD_REMOVED` or `FIELD_CHANGED`), a field a before-hook set included; any other is made again from what its before-hooks left, which run once. A write whose collection was deleted, or deleted and made again under its slug, while it waited is refused rather than written into what took its place. The review now counts the links a removed many-to-many holds, and a save that drops a many-to-many's links (removing it, making it a single relationship, or pointing it at another collection) deletes only the count confirmed, refusing where a link was added since. On PostgreSQL each entry-write transaction takes two short statements more; on SQLite a write waits as long as the database's `busyTimeout`, then is refused as the database being busy (`DATABASE_BUSY`), and one in a transaction already open is refused at once (`COLLECTION_BEING_CHANGED`) while a save holds its collection.
