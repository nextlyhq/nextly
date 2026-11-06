---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

The Schema Builder's save preview no longer reports removing a field that
holds values as safe.

- A removed field's values are counted where they are stored: a translated
  field's in its translations table, every other field's on the main table,
  by its stored column name. Before, a translated field was counted on the
  main table, and a field whose name differs from its column (`metaTitle`,
  stored as `meta_title`) was queried by the wrong name. Both counts failed
  and read as 0.
- A count that cannot be read is no longer taken as 0. The removal is classed
  `destructive`, carries `rowCountUnknown: true` (a new optional field on the
  preview's removed rows), and a warning says the count could not be read.
  A field group or many-to-many relationship, whose values live in their own
  table, is reported the same way.
- Switching a relationship between one related entry and many is classed
  `destructive`, in both directions, with a warning that its values are
  stored differently and may be lost.
