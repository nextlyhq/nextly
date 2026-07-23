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

Add the cache-revalidation tag scheme and a `revalidate` config option.

Collections and singles now accept a typed `revalidate?: { tags?, disable? }`
option (replacing the untyped `custom.revalidateTags` convention), and the core
computes the `nextly:*` cache tags a content change invalidates (collection, id,
id+locale, and slug, busting the previous slug too on a rename). Tags are the
framework-neutral foundation for on-publish revalidation; the write-path wiring
and the Next cache adapter that flushes them follow.
