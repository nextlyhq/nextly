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

Granting a role a permission that did not exist yet is fixed on two counts.

The created permission's slug was composed as `resource-action` while every
authorization check reads `action-resource`, so the new permission was one
nothing could find: the grant showed as assigned in the admin panel and
authorized nothing. Only the REST route reached this path, because the two
in-tree callers pass an explicit slug.

The same path also threw on SQLite. It called Drizzle's transaction directly,
and better-sqlite3 rejects an async callback, so creating a permission failed
outright on the default dialect. It now uses the cross-dialect helper the rest
of the services use.

Composing a permission slug is now a single shared function rather than a
string built by hand at each of eleven call sites, which is what let one of
them drift.
