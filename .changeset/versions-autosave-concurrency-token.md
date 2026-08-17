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
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

feat(nextly): add a concurrency token to the autosave compare-and-set

The rolling autosave row is rewritten in place, guarded by a compare-and-set so
that two tabs belonging to one author cannot overwrite each other. That guard
compared `updated_at` against the value the write had observed, and the stored
resolution of a timestamp differs per dialect: SQLite keeps whole epoch seconds
and MySQL milliseconds. Two rewrites close enough together serialize
identically, so the second writer observes exactly what the first wrote, its
predicate matches, and it overwrites newer work believing the row untouched.

`nextly_versions` gains a monotonic `revision` counter. The compare-and-set
reads it, applies only while the row still holds it, and writes its successor.
A counter has no resolution to exhaust, so the guard holds however close
together two writes fall.

The column is additive and carries a default, so `nextly migrate` adds it to
databases that already exist rather than refusing the migration.
