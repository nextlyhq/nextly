---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Schema Builder apply now refuses to drop a column unless the drop was explicitly acknowledged.

Applying a schema change through the admin Schema Builder or the REST apply route no longer relies on a single request-level `confirmed` flag to authorize data loss. Each column drop is classified on the server, and the apply fails closed (surfacing as a confirmation-declined error, no DDL run) unless the request carries an explicit acknowledgment for that specific column. A buggy client or an automated caller that posts a desired schema with a column removed can no longer silently destroy that column's data. The admin Schema Builder confirmation dialog sends the acknowledgment for every field it lists as removed, so the deletion experience is unchanged for admins. Renames (a drop paired with an add) and code-first deletions applied through the terminal path are unaffected.
