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

Creating or updating an entry now records a webhook event.

Entry creates and updates are written to the webhook event outbox inside the same database transaction as the change itself, so an event is never recorded for a write that rolls back and never missed for one that commits. The event carries the document with password and hidden fields removed, and reports which fields changed by comparing against the document as it stood before the write. On a localized collection the translations and per-locale status for the locale being written are included on both sides of that comparison, so a translation nobody touched is not reported as changed and a per-locale publish is reported with the status it actually committed. Every event is attributed to whoever performed it: an API key is recorded as the key itself rather than as the user that owns it, a server-side write is attributed to the user it acts for, and an uninitiated write is recorded as the system. Deletes, status changes, singles, media, users, and form submissions are later changes.
