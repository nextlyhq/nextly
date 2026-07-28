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

Plugin-contributed field types can now validate what they store. `PluginFieldType.validate(value, { data, req, field, mode })` returns `true`, a message, or a list of issues with their own paths. It runs after the built-in rules for the storage primitive and before the field's own `validate`, so a schema author adds rules on top rather than replacing them. Previously a custom type was only ever checked as its storage primitive, so a plugin could invent a field type but state nothing about what belonged in it. `contributes.fieldTypes` is documented for the first time.
