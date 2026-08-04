---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Plugin field types now work on every surface that accepts fields, and a column added to an existing table gets the same storage class the ORM binds.

A contributed field type can be declared in `contributes.extend` and `defineFieldGroup`, not just in collections and singles, and `pluginField()` keeps the shape it was given so a plugin's own factory stays typed. The page builder exports `isBlocksField` again and reaches core only through `@nextlyhq/plugin-sdk`, which now carries the field contracts a contributed type needs; it also states the core version its `blocks()` factory actually requires, so installing it against an older core fails at install rather than at runtime.

A contributed default is checked against the type's storage primitive before it reaches the database, disabling a plugin no longer leaves its empty-value callback registered, and `nextly build` and `migrate:check` now refuse a field type no installed plugin offers instead of generating types for a schema production would reject. Field names are validated even when the field's type is deferred to boot, so a duplicate or SQL-reserved name can no longer reach schema generation.

Plugin options declared on a code-defined user field are persisted and reach the contributed admin component, and a `number` field added to an existing table is created as the integer the ORM binds rather than NUMERIC/DECIMAL/REAL, honouring `dbType: "decimal"` and `format: "float"` for fields that ask for fractions.
