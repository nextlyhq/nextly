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

A value a unique custom user field already holds for another user is now refused with a conflict (`DUPLICATE`), when creating or updating a user, and a refused update changes nothing: the account's other fields, its roles and its custom fields are written together or not at all. Before, creating such a user took the refusal for a missing table: it created the user without any custom fields and stopped writing custom fields for the rest of the process, and an update logged it and carried on. On MySQL, a unique field of a plugin type stored as text with no `maxLength` is now a `VARCHAR(255)` column carrying its unique index, as a built-in text field is, rather than a TEXT column (which MySQL cannot index without a key length) that stopped `nextly migrate`. An install where that column is already TEXT keeps it, with every value whole: `nextly migrate` stops, naming the field, until the column is changed to `VARCHAR(255)` or `unique` is removed. A plugin type stored as long text or JSON cannot be unique: the config is refused at the field, as a textarea's is.
