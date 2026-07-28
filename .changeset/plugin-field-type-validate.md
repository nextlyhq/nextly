---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/plugin-form-builder": patch
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

Plugin-contributed field types can now validate what they store. `PluginFieldType.validate(value, { data, req, field, path, mode })` returns `true`, a message, or a list of issues with their own paths. Previously a custom type could be invented but say nothing about what belonged in it.

Values of a custom type are now also checked against the storage primitive the type declares. A `number`-backed type used to accept the string `"3"` on its way to a numeric column, because the built-in rules only ever matched built-in type names; they now run first, then the type's `validate`, then the field's own. A disabled plugin's field types keep their schema but no longer run their `validate`, matching how every other plugin behavior is skipped. `contributes.fieldTypes` is documented for the first time.
