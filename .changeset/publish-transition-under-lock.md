---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
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

The publish/unpublish permission gate now holds under concurrency and for
batch writes.

A batch or transactional write classified whether it was publishing or
unpublishing from the document's status read before it took the row's write
lock, so a concurrent writer could move the row into or out of published in that
window and the write would slip the transition past the gate. Batch and
transactional writes now resolve the caller's publish/unpublish authorization
once before the transaction and enforce it against the status read under the row
lock, closing the race. A scoped API key running a bulk update or duplicate is
also judged on its own publish grant, matching the single-write path.
