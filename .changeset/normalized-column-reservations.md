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

Catch every spelling of a Field Group field name that collides with one of its table's system
columns, not only the two that were listed. `CreatedAt` reaches the same `created_at` column as
`createdAt` does, and was accepted. Names are now compared as the column they become, so a field
declared with a plugin-contributed type is checked too — its type registers after the config is
read, and it was previously skipped.

A Field Group field that references another Field Group may take any name that a Field Group
instance does not already use for itself: not `id`, which is the instance's own identity, and not a
name that converts to `created_at` or `updated_at`, which a read would fill with the row's
timestamp instead of the referenced data.
