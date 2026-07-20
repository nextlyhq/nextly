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

Version history now says who made each change, and shows linked entries and media by name instead of by id.

Reading a document's version history previously returned only the raw user id of whoever wrote each version, and any relationship or media field inside a stored snapshot came back as a bare identifier. Both are now resolved on the server: each version carries the display name of its author, and snapshot references resolve to a name (or, for media, a filename and thumbnail).

References are resolved through the same access-checked read path a normal request uses, so this never exposes a linked document the caller is not allowed to read; one they cannot read comes back with its id and no label. Attribution and reference lookups never fail a history read: a deleted user, or an unreadable link, degrades to an unlabelled value.
