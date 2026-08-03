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

Make the junction-table rule type-agnostic in the Schema Builder DDL generator. A field
carrying `relationType: "manyToMany"` keeps its links in a junction table rather than a column on
its own row, and the column descriptor and the runtime read path both decide that from the option
alone. The generator decided it from the field type as well, so an `upload` declared many-to-many
was created as a parent column that nothing addresses and was given no junction table to read from.
It now emits no parent column and one junction table for either type, and a single-target upload
still gets its own column.
