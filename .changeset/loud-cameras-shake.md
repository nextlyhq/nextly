---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

Apply read hooks per collection, and hand them the values a caller sees.

A read hook that reads a different collection now runs that collection's own
hooks instead of silently skipping them, so a hook cannot reach rows the other
collection withholds. A hook reading the collection it is already running for
still skips them, which is what stops it calling itself without end.

`afterRead` is now handed decoded JSON values rather than the storage encoding
SQLite returns, and a related row now gets the target collection's own field
`afterRead` hooks, so a field masked on the target's endpoint stays masked when
it is reached through a relationship.
