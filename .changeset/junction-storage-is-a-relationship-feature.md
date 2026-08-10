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

Keep the Schema Builder's DDL generator, the column descriptor and the write path agreeing on which
fields are junction-backed. A field carrying `relationType: "manyToMany"` was treated as
junction-backed by the descriptor whatever its type, while the generator emitted a junction table
only for a `relationship`. An `upload` declared many-to-many therefore got a parent column that the
runtime schema and the schema diff did not know about, so the diff proposed dropping it on every
apply.

Junction storage is a `relationship` feature, because that is the only shape the read and write
paths implement, so an `upload` carrying that option keeps its own column and is unaffected: a
single target is a foreign key, `hasMany` or an array of targets a JSON array of ids. A
`relationship` many-to-many is unchanged — no parent column, one junction table.
