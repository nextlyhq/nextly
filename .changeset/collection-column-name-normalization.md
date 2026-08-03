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

Resolve a field name to its database column the same way everywhere. A Schema Builder collection
created a field whose name began with a capital under an extra leading underscore, while the
runtime schema and the schema diff addressed it without one — so the table and every read of it
disagreed, and the diff reported the column missing on every apply.

Two decisions that depended on the field's declared name now use its column instead, so correcting
the conversion does not break configurations that work: a field named `Title` replaces the injected
`title` column rather than colliding with it, and two fields whose names reach one column (such as
`foo_bar` and `FooBar`) are reported as duplicates where the names are chosen instead of failing
during schema application. Field types that store their values in their own tables, such as a
component or a many-to-many relationship, are exempt from that duplicate rule: they are keyed by the
field's declared name, so two of them whose names converge stay distinct.

Emitted SQL is unchanged for every field name the Schema Builder accepts.
