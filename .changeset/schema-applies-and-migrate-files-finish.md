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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

A development schema apply on PostgreSQL failed on a database whose owner registry
did not exist yet, with "current transaction is aborted": the apply read the registry
inside its own transaction, and the failed read aborted it. The apply now asks the
catalog whether the registry is there before reading it.

Renaming a field to a required one, on a table with rows, was refused as if the field
were added without a default, though the rename carries every row's value. A required
field a confirmed rename fills is now judged by the rows of the column it is renamed
from, and refused only when some of them hold no value.

`nextly migrate` failed with "duplicate column name" on a translated field added to a
translated collection when its translations column was already there, as a dev push,
the Schema Builder or a change that stopped part-way leaves it. The migration file now
adds only a missing column, and a column already there is judged, as before, by whether
it can hold the field.

When two server processes added fonts to a site at once, the page builder sometimes
stored one add's files at the media root rather than in the site's Fonts folder: the
media library refused that add's folder because the other process had just made one.
The add now takes that folder instead.
