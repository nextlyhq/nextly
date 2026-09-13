---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Three corrections to the shared RBAC epoch, all of them a cache that went on
answering after the answer stopped being true.

A batch of permission writes defers its shared announcement until the batch
ends, and the local retirement that goes with it empties the caches the
permission module holds. An API key's copied grants are not one of those, so a
key went on answering with revoked grants for the batch's whole length. Every
cache now asks one predicate about whether a cached answer is still current, and
a batch holds that predicate closed for its length, so the caches living
elsewhere are covered by the same act rather than by being remembered.

A write that reached the shared row but whose read-back failed left the instance
holding the value from before the write while believing it owed nothing, so
answers filed under the old value read as current again. An epoch counts as
trustworthy now only once its value has actually been read back.

An installation whose epoch row does not exist yet answered with a value every
such installation shares, so failing over to a different database, or restoring
a backup taken before the first role change, left cached answers looking
current. The row is created with an identity of its own on first read instead.
