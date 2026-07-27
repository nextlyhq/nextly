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
"@nextlyhq/ui": patch
---

Emit webhook events when media changes.

Uploading, editing, or deleting a media item now records a `media.uploaded`,
`media.updated`, or `media.deleted` event in the outbox, attributed to the
acting user or API key, so webhook subscribers are notified of media changes.
The event is written in the same transaction as the media row, and physical
file storage is touched outside that transaction (and, for deletes, only after
it commits) so a failed event never leaves the database and the stored file out
of sync.
