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

The SQLite bootstrap DDL was missing columns its own schemas define — `users`
lacked `must_change_password`, `media` lacked `focal_x`, `focal_y` and `sizes`.
A database created from it (the fallback used when drizzle-kit's push cannot
run, for example without a TTY) therefore had tables the ORM could not write
to: Drizzle names every column in an INSERT, so each write naming one of those
failed outright. The columns are restored, and a test now compares every table
in that DDL against the schema that defines it, so the two cannot drift apart
again in silence.
