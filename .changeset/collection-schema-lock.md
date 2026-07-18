---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
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

Schema Builder saves for collections now reject stale saves reliably.

The collection schema apply had an optimistic-lock check, but the stored
schema_version was never advanced on apply, so the check compared against a
value that never changed and a second admin editing the same collection could
still overwrite the first (last-write-wins). The apply now persists the bumped
schema_version, and the check runs through the same guard as singles and
components: an omitted version is rejected and a stale version is reported as a
conflict for the client to reload and retry. All three entity kinds now share
one optimistic-lock behavior and error surface. If the post-apply metadata
write fails, the response reports the current version rather than the bumped
one so a retry re-attempts the bump.
