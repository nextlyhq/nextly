---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin-css": patch
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

Creating an entry now records a webhook event.

Entry creates are written to the webhook event outbox inside the same database transaction as the entry itself, so an event is never recorded for a write that rolls back and never missed for one that commits. The event carries the full document as the API returns it, with password and hidden fields removed, and is attributed to whoever performed the write — an API key is recorded as the key itself rather than as the user that owns it. Updates, deletes, status changes, singles, media, users, and form submissions are later changes.
