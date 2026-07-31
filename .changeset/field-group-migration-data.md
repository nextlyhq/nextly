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

Groundwork for the field group storage migration: it can now rewrite the vocabulary stored inside rows, not just the tables and columns those rows live in. Stored field definitions, the source path a field group records, the scope a schema event carries, and the type key inside version snapshots and event payloads all move to the field group spelling.

The two ledgers whose size follows a site history, content versions and the event outbox, are walked in bounded batches that each commit on their own and record how far they got, so an interrupted upgrade resumes near where it stopped instead of starting the table again. Every step then rescans its table rather than trusting that record, so a resume can never report a completeness it did not reach. Nothing calls the migration itself yet.
