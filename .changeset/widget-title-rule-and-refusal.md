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

Name an entry the same way on every surface, and announce a refused schema
change only where the metadata actually moved.

Three spellings of "is this value a usable title" disagreed: one accepted a
whitespace-only string, one refused a number, and one refused a bigint. A
collection whose title field held an invoice number was named by it in the
editor and by its id on the page comparing its versions. There is now one rule,
`readableTitleText`, and the three callers ask it.

The dashboard's recent-entries projection also named fewer candidates than the
heading walk considers, so `label`, `subject` and `heading` were absent from
every real read and could never be reached. It now spreads from the same list
the walk reads.

The widget source refresh no longer announces a deferral on a reload that
carries only a refused change: that path skips the metadata sync by design, so
its registry still describes the unchanged table, and announcing one withheld
generated cards that were working.
