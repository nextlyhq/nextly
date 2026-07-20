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

Version history now says who made each change.

Reading a document's version history previously returned only the raw user id of whoever wrote each version, so a history view had nothing to show but an identifier. Each version now carries the display name of its author, resolved in a single batched lookup.

The projection is a name only, deliberately not an email address, so reading history does not require permission to read users. Attribution never fails a history read: a deleted user, or an unavailable lookup, leaves the version unattributed rather than erroring.
