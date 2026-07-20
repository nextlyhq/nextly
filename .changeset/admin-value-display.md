---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin-css": patch
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

Field values can now be shown read-only, without an editable form around them.

The admin could previously only render a field value through its input component, which needs a form behind it. Showing a stored value for reading — a past version, a preview, a comparison — now has a dedicated display for every built-in field type, including the container types (repeater, group, component) that the entry list only ever summarised as a count.

Passwords are never rendered. Values are read through one shared normalizer, so a value stored as JSON text on SQLite and as real JSON elsewhere displays identically.
