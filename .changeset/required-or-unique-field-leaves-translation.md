---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

A translated field marked Required or Unique can now stop being translated in one change, in the Schema Builder (a collection's save and schema dialog, a Single's save and schema dialog, a field group's schema dialog) and through `nextly migrate:create`. Its shared column is created without the setting, filled with the default language's values, and then made required or unique. Before anything runs, the Builder checks that the values can take the setting: an entry with no default-language value refuses Required, and two entries that would end up with the same value refuse Unique. The refusal names the field and how many entries are in the way, never a value, and the schema dialog shows it before Apply. `migrate:create` has no database to check against, so it applies the setting after the copy and before the translated column is dropped, and a value the database refuses leaves everything in place.
