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

Collections, field groups and Singles use the shared list layout, so search, filters, the column
control and the spacing above the table match every other list in the admin.

Their empty states are part of that now. Each page carried its own, and each drew the same
distinction by hand — one message when the list is genuinely empty, with a button to create the
first record, and a different one when a search or filter simply matched nothing. That rule now
lives in one place, so no list can drift into offering "create your first" to someone whose
search just came up short. The empty state also reads as a heading to a screen reader, which it
did not before.

When a collections or field-groups list fails to load, the page now reports it the way every
other list reports a failure, instead of showing a separate warning above a table that is still
drawn.
