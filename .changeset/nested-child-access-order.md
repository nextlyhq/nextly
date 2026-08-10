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
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Field-level read access on an expanded relationship now applies to each related row before its parent's `afterRead` field hooks run, matching a direct read. Previously a parent hook was handed a nested child with the caller's denied fields still present, so a hook that copied such a field onto an allowed key exposed it under that key even though the child's own field was redacted afterward.

Behavior change: a field `afterRead` hook can no longer observe a related row's caller-denied field, so it can neither leak nor mask on one. A value that must stay hidden should be protected with an `access.read` rule keyed on the caller rather than a hook that reads another field the caller cannot see. Trusted reads (`overrideAccess`) are unaffected, since field access is skipped for them.
