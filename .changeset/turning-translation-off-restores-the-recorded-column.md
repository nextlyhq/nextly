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

A migration file that turns translation off now puts each translated column back on the main table as the main table's snapshot records it: its type and its default, and, once its values are back, NOT NULL for a Required field and the unique index for a Unique one. A Required field one of whose entries has no value in the language kept is refused before the setting, naming the field, and its translations stay. Before, the column went back nullable and without its unique index, and the main file that follows was refused as drift on every dialect. On MySQL, a long text field went back as LONGTEXT while the snapshot records `text`, so `nextly migrate` refused the main file that follows as drift, and a Schema Builder save that turned a collection's translation off through its files was refused the same way. `nextly migrate:create` now refuses, before writing any file, a change that turns an entity's translation off and changes its table in other ways too (a field added, an index changed). Those files could not be applied: `nextly migrate` refused them as drift after the turn-off file had run. Turn translation off on its own and run `nextly migrate:create`, then make the other changes and run it again.
