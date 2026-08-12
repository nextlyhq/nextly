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
"@nextlyhq/builder": patch
---

fix(nextly): take the HTTP status from the error code, and record template changes

Eight throw sites restated a status the canonical map already answers, so the
number lived in two places and only one would be found by someone changing it.
The status now comes from the code alone.

Deleting an email provider nulls the reference on its delivery rows rather than
removing them, so the log stays evidence of what was sent. That behaviour now
has per-dialect coverage on PostgreSQL and SQLite, where it was previously
untested. MySQL still has no such constraint: adding one requires nulling
pre-existing dangling references first, which nothing in the schema pipeline
does yet.

Email template mutations now reach the activity log. A template decides what a
password-reset message says and who it appears to come from, and that change was
previously invisible after the fact. Entries carry field NAMES only.
