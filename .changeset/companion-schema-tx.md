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

Bind localized companion schema loading to the caller's transaction.

Deleting or updating a row in a localized collection assembles its document
from the companion `<table>_locales` table, which loads that companion's
runtime schema. That metadata read previously went back to the connection pool
even when the write ran inside a caller-owned transaction, so on a small or
exhausted pool it could stall the write while the transaction held the only
connection. The companion schema load now runs on the transaction's own
connection, completing the transaction-bound write path for localized content.
