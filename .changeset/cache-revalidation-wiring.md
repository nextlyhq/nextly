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

Bust cache tags on every content write.

Each collection create, update, publish/unpublish, and delete — and each single
write — now computes the cache tags it invalidates and flushes them after the
transaction commits, through a registered cache revalidator (a no-op until a Next
cache adapter is present). A rename busts both the old and new slug tags, a delete
busts the collection and entry-id tags, and a write that records nothing (a
rejected or no-op write) busts nothing. Bulk operations aggregate their items'
tags and flush them once. This wires the tag scheme added previously to the write
path; the read-side helpers and the Next cache adapter that turns the tags into
`revalidateTag` calls follow.
