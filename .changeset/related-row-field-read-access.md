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
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Field-level read rules now apply to related rows. Populating a relationship copies the whole related row into the parent entry, and a field's `access.read` was only ever evaluated against the collection being read, never against the collection on the other end of the relationship. A field you protected on one collection was therefore returned in full to anyone who reached it through a relationship from another, at any depth. Passwords and system columns were already stripped there; this closes the same gap for the rules you write yourself.

Each related row is now judged by its own collection's rules, for the caller making the request, so a relationship cannot return more than a direct read of that row would. Trusted server-side reads that pass `overrideAccess` are unaffected, and secrets are still stripped for every caller regardless.

If you relied on reading a protected field indirectly through a relationship, that field will now be absent: read it as the collection that owns it, with a caller its rule admits.
