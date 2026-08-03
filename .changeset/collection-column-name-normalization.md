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

Create a Schema Builder collection's columns under the same names the rest of the framework uses.
A field whose name began with a capital was created with an extra leading underscore, while the
runtime schema and the schema diff both addressed it without one — so the table and every read of
it disagreed, and the diff reported the column missing on every apply.

No collection is affected: the Schema Builder already refuses a field name beginning with a
capital, which is why the divergence had gone unnoticed. Emitted SQL is unchanged for every name
it accepts.
