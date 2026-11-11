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

`nextly migrate:create` no longer writes the drop of a field group or Single something still depends on. When a field group or Single is removed from the configuration while a remaining field still places the field group, a plugin or the app declares a foreign key to its table, or a plugin or the app adds a column or index to it, or a foreign key points at its translation table, the command refuses with the message a delete gets, naming each with its owner, before it writes anything. A plugin hook that still extends a removed field group's or Single's table is named with what it adds, where the command used to stop with "Validation failed.". A collection, Single or field group sharing a slug and removed together is each named with its own dependents, the later one with its kind, as `seo (field group)`.
