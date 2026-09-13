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
"@nextlyhq/plugin-mcp": patch
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

An edit made to a collection that has been saved but not yet deployed no longer
narrows the column its own creation migration is about to write.

Such a collection has a registry record and no table, and the two artefacts
replay in order: the create runs first, then the edit. Everything the edit
believes about that table is therefore a prediction, and the indexes and
foreign keys were already predicted for exactly this reason. The column TYPES
were not — they were reported as unknown, which sent MySQL's `MODIFY` to the
legacy renderer.

The two renderers now disagree by design, so that fallback had a consequence: a
float field is created as `double`, and a follow-up requiredness edit in the
same window emitted `MODIFY COLUMN ... decimal(10,2)`. Both artefacts are
correct read alone, and applying them in order narrows and rounds a column the
deployment had just built.

The planned types are predicted by the same class that emits the CREATE, beside
the planned indexes and keys, so a prediction and the statement it predicts
cannot describe different columns.

The index prediction in that same place was still asking the legacy renderer
too. It now judges what the create emits, which matters on MySQL where a
`select` is created as `varchar(...)` and indexable while the legacy answer is
unbounded `text` and is not: the index was installed and not predicted, so a
later edit did not know to drop it.
