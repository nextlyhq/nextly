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

A Schema Builder save of a field group or a Single now writes its migration, as a collection's always has. Creating, changing or deleting one in the Builder writes a migration and snapshot to the migrations folder. In development they are run and recorded applied; elsewhere the deploy's `nextly migrate` applies them. Before, these saves changed their table with no migration recording it, so the next migration, a collection's included, was refused with "schema drift detected: table 'comp\_<slug>' present in DB".

A field group's or Single's table an earlier Builder save made with no migration is adopted the next time it is saved in the Builder: the save first writes a migration describing the table as it stands. `nextly migrate`'s drift refusal names such a table and says to save it once in the Builder.
