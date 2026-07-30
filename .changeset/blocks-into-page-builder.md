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

The `blocks` field type now comes from `@nextlyhq/plugin-page-builder` instead of core.

**Breaking, and it needs a one-line change.** `blocks()` and the blocks document types were exported from `nextly/config`. They now come from `@nextlyhq/plugin-page-builder`, and the field only exists when that plugin is installed:

```diff
-import { blocks } from "nextly/config";
+import { blocks } from "@nextlyhq/plugin-page-builder";
```

Nothing about a stored document changes. Existing columns, values and documents are untouched; only where the field type is declared moves.

Core shipped this field while being unable to deliver it: a JSON column and a read-only summary, with no editor unless the page-builder plugin was installed, at the cost of a hard dependency on the document engine and a branch in every switch that dispatches on field type. Declared by the plugin, the field arrives with the code that makes it work, and "Blocks" appears in the Schema Builder only when it can actually be used.

Plugin field types can now declare `emptyValue`: what a field of that type holds when nothing has been written to it. Two paths needed it and had to agree — backfilling a required column added to a table that already has rows, and seeding a required field on a record created without one. Both previously derived that from the storage primitive, so a type storing a structured document got `{}`, which satisfies the column and then fails every read expecting the structure. The value is returned rather than SQL, so core quotes it correctly for each dialect.
