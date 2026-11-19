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

A Schema Builder save that applies its change directly in development no longer refuses states it can finish: a table missing from the database, which the save builds whole again; a translated column that the main table keeps, as setup at start and `db:sync` leave it; a translations column or table the save itself translates, left by an earlier change; a table already standing as the save leaves it, such as a rename made before; and a change that an earlier save stopped part way, such as a Unique setting refused over duplicate values. Once the duplicates are fixed, saving again finishes the change.

When a save is refused because the table is not what the migration history records, the message now gives the way on that works for a save: put the table back as the history records it, then save again. It no longer suggests `nextly migrate` commands that cannot act on a refused save, whose migration files are withdrawn.
