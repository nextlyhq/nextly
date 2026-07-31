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

`nextly migrate` now migrates field group storage to its new format. The rename Nextly has been preparing across several releases becomes real here: tables, columns, and the vocabulary stored inside registry rows, version snapshots and event payloads all move to the field group spelling.

It runs as a phase between the core schema reconcile and your own migration files, so a committed migration that names a field group table is applied after those names have moved rather than before. A database already migrated is left alone, so this is safe to run on every deploy rather than something to run once and remember.

The run records what it is about to do before it starts, verifies the result against the database rather than trusting that its steps ran, and only then marks itself finished, so an interrupted upgrade resumes instead of guessing. While it is in flight, changes to field groups are refused: editing one mid-run would leave a database indistinguishable from the migration's own work, which no later check could untangle.
