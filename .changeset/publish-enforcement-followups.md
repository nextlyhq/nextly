---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
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

Harden the publish/unpublish permission gate for two edge cases.

A write that carries an explicit `status: undefined` (something a Direct API
call, a Server Action, or a hook can produce, though JSON REST cannot) no longer
silently unpublishes a published entry or single. That value means "no status
change", so it is dropped before the write instead of being sanitized to a
database `NULL` that moved the row out of published without the publish gate.

Writes performed inside a caller-owned transaction (the transactional bulk and
single-entry create/update paths) now run every read on that transaction's own
database connection. Previously the publish/unpublish permission check, the
collection metadata and owner-constraint reads, and the built-in sanitization
hook's field-metadata read all went back to the connection pool from inside the
transaction, which could stall the write against a small or exhausted pool while
the transaction held the only connection.
