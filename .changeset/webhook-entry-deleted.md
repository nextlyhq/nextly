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

Emit an `entry.deleted` webhook event when a collection entry is deleted.

Deleting an entry now records a durable outbox event carrying the removed
document in the same read shape the `entry.created`/`entry.updated` events use —
component subtrees and many-to-many ids populated, password and hidden fields
stripped — so a subscriber sees a consistent payload for every lifecycle event.
The delete, its component cascade, and the event now run in one transaction, so
the event never fires for a deletion that rolled back and a cascade failure no
longer leaves orphaned component rows. The event is attributed to the acting
identity (user or API key), matching create/update.
