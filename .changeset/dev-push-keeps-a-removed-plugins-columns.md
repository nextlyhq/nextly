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

A development push no longer drops what a plugin removed from the configuration added to another owner's table. Its columns keep their values, and its indexes, foreign keys and checks stay, until `nextly plugins uninstall` removes them or the plugin comes back, as its own tables already did. A push now records who added each column, index, foreign key and check to a table another owner declared, as `nextly migrate` does.

A push that would still change one of those elements is refused before anything runs, naming the plugin and the element: another owner declaring an element of the same name with a different shape, or, on SQLite, a change that rebuilds the table holding a removed plugin's column, foreign key or check. A plugin still configured that stops declaring one of its elements still has it removed.
