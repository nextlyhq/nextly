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

Turning localization off in `nextly.config.ts` now brings your content back onto the main table. Previously only the Schema Builder toggle did this, so setting `localized: false` in configuration left every translation in a table nothing read any more and fell back to whatever the entity held before it was localized. Turning localization on again no longer trusts the stale rows that companion still holds.

Enabling localization and Draft/Published in the same edit now applies. It used to fail part-way and could never succeed on a retry, because the copy read a `status` column the schema push had not added yet.

Saving a localized entity is faster, and on PostgreSQL a class of failure is gone. Every localized write used to ask the database whether each translation table existed — once per entity, plus once per field-group type in the payload, before the write and again inside it. That answer is now resolved once and remembered. The read that builds the response used to discover the same thing by running its query and catching the failure, which on PostgreSQL aborts the whole transaction: writes that should have succeeded failed with `current transaction is aborted`, blaming an unrelated statement.

When a translation write is refused, the message now names the right fix for where you are running. Production is told to run `nextly migrate` instead of `nextly db:sync`, which is a development tool and cannot help there — and `nextly migrate` now creates missing translation tables and repairs installs that enabled localization before Nextly began recording it.
