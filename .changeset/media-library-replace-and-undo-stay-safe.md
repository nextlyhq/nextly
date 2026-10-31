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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

Media Replace, delete and Undo are safer.

- Replacing a file keeps the old one while a JSON field, a block document or
  any other value names it by its address (`src` or `url`), not only rich
  text. Each recorded use now notes whether it names the item by its id or by
  its address.
- A page that still names a replaced file's old address goes on counting as a
  use when it is saved again, so the item is not shown as unused and its old
  file is not deleted without warning.
- Deleting more than 100 selected items works: the admin sends them in
  batches of at most 100 under one Undo.
- Every item of a large delete is removed once its Undo window ends, not just
  the first 25.
- Undo of several items brings back all of them or none of them.
- Deleting an item that is already waiting to be deleted shows its real Undo
  deadline.
- Where an item is used says only the languages you may read: a translation
  you cannot read shows neither its fields nor its language, and one you can
  read is no longer hidden.
- Until `nextly media reindex-usage` has run, the delete dialog and Used in no
  longer say an item is unused, and the Unused view lists nothing until the
  counts confirm it can.

The media usage table gains an `address` column. It is new in this release,
so `nextly migrate` creates it with the column; a database that created the
table from an unreleased build adds it the same way.
