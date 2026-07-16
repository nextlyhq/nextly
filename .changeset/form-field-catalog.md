---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

The shared field-type catalog now describes the form surface, and plugin field types can declare where they belong.

`nextly/field-catalog` gains `FORM_FIELD_TYPE_CATALOG`: the form builder's thirteen field types described once in the same catalog the schema builder and user-profile pickers already read, including five form-surface types (url, phone, time, file, hidden) that are deliberately not part of the canonical collection field union — form fields live in a form's JSON, so these can never reach the schema pipeline. The url and phone descriptions are shared with the user-profile surface, so a "URL" field looks and reads the same everywhere.

Plugin-contributed field types can now declare `surfaces` (entries, users, forms) on their registration. A type only appears in a surface's field picker when the surface admits it, the type declares it, and the host has not excluded it — each level can only remove types, never force one in. Omitting `surfaces` keeps today's behavior (the type appears on the entry editing surface only).
