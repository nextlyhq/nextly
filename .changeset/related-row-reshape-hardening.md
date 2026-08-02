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

Harden nested field-level read access against `afterRead` hooks that reshape a
read response. A related row a hook clones, or one whose nested group/repeater
row a hook replaces, appended, or rebuilt, no longer has its access-controlled
fields judged on untrustworthy evidence: any related subtree that is not the
same objects the read first sanitized is failed closed (its access-controlled
fields denied), the whole subtree including the root, so an inverse rule or an
ancestor rule cannot fall open on the reshaped copy. A field a hook reintroduces
on an existing child in place is re-stripped before an ancestor hook can copy it,
and a denied source field is hidden from the source collection's own field hooks
so it cannot be copied onto a selected field. Transforming related rows in place,
preserving object identity, keeps their field access exact and is unaffected.
