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
"@nextlyhq/plugin-form-builder": patch
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

A field a caller may not read can no longer be used to filter

Field-level read rules redact values from rows that have already been selected,
so they were powerless against a `where`: the row set itself varied with the
hidden value. A caller could ask `equals` for each candidate and read the answer
off which query returned the row -- the value never rendered, and fully
recoverable.

Demonstrated against a real database before being fixed: with a `codename` field
denied to the reader, filtering on it returned different rows per term while the
column was correctly absent from every response.

A filter naming a field that carries a read rule is now refused, and says which
field. Conservative on purpose -- a read rule is a function of the row, and at
query time there is no row to judge, so a field that CAN deny is treated as one
that does. Fields with no read rule are unaffected, as are callers passing
`overrideAccess`, which have already decided who is asking.
