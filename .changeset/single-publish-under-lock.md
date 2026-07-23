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

The publish/unpublish permission gate on Single documents now holds under
concurrency.

A Single update classified whether it was publishing or unpublishing from the
status read before it opened the write transaction, so a concurrent writer could
move the document into or out of published in that window and the write would
slip the transition past the gate. The update now pre-resolves the caller's
publish/unpublish authorization before the transaction and enforces it against
the main row (and, for a localized write, the write locale's companion status)
read under the row lock, closing the race. An unauthenticated caller can no
longer publish or unpublish a publicly-writable Single unless an explicit rule
grants it, and a first-update hook that reads a status-enabled Single now sees
its default `draft` status.
