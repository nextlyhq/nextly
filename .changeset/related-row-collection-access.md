---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/eslint-config": patch
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

Stop a relationship from populating a row the caller may not read. A related
row belongs to another collection and carries that collection's own read
rules, but expansion selected it straight from its table and applied only
field-level redaction — so a caller refused the collection outright still
obtained its rows by populating a relationship that pointed at them.

The target collection's stored read rules are now evaluated for the caller
before its rows are populated, on single reads, listings and nested hops. A
refused target reads as an absent relationship rather than an error, so one
unreadable reference does not refuse the whole parent read.
