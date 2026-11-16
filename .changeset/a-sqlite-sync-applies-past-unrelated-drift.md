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

On SQLite, `nextly db:sync` and the dev auto-sync no longer refuse a whole push that drizzle-kit applies, such as one adding a plugin collection's fields, over two changes the push never asked for:

- the media table's retired `sizes` column is kept, as it is until `nextly media remove-sizes --apply --drop`, instead of being planned as a drop;
- a field-group table is no longer rebuilt over a column default. Its runtime table now declares the defaults its CREATE writes, and a rebuild of a table an earlier release created, which would only copy every row and column onto the same columns, is left out with a warning naming the table.

Any other rebuild or drop the push did not plan is still refused.
