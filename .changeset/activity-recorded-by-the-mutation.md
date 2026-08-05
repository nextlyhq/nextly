---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
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
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

A content change and the activity entry describing it are now one transaction.
The entry was written from a post-commit hook, in its own transaction, with its
failure swallowed, so a change could commit and then fail to record — leaving an
edit nothing described and no way to notice. It is now written at the mutation
seam, inside the write, and a change whose entry cannot be stored no longer
survives.

An update also records WHICH fields it changed, as names. Never values, never
document bodies.

Two consequences worth knowing. Writes performed by an API key or by internal
maintenance no longer produce an entry: the trail attributes to an account, and
a key's own id is not one. And `registerActivityLogHooks` is gone from
`nextly/hooks` — the recording it wired up now happens at the write itself.
