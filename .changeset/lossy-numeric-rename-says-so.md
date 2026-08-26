---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Schema renames no longer claim "data preserved" over a conversion that changes the stored values.

Renaming a column between two types in the same family was offered as preserving the data. Exact and approximate numerics share that family, so converting a `numeric(10,2)` money column to `float8` was labelled "data preserved" while every value became the nearest binary float — `19.99` stored as `19.989999999999998` — and the reverse rounded to the target scale and failed outright above its precision. The same label appeared in the terminal prompt and in the Schema Builder dialog.

Preservation is now answered separately from compatibility. Family membership still decides whether a drop/add pair can be read as a rename at all; whether the values survive it is its own question, and both surfaces read that instead. A conversion that rewrites values says so and explains what happens to them, and neither surface pre-selects it when a preserving rename is available.
