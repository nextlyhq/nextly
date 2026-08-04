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

A timestamp is stored the same way whatever the server timezone is. The raw-SQL write paths bound a JS Date directly, so the driver serialized it with the local offset and a column declared without a time zone kept the local wall clock, while every read interpreted that wall clock as UTC. A row written and read back on a server five hours ahead of UTC came back five hours late. Values are now encoded through the column the same way a Drizzle query encodes them, on PostgreSQL and MySQL; SQLite was unaffected, storing unix seconds, which carry no zone.

Rows written before this on a server that was not on UTC keep the wall clock they were given, so a table can hold both conventions until those rows are corrected. Deployments running UTC, which includes every default container image, are unaffected either way.
