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

Restoring a version now enforces the same read permission as viewing history.

Restore is a write, so it was authorized as one — which meant the permission
that guards version history was never checked. Someone able to edit a document
but not read its history could recover an earlier version by restoring it. An
API key was judged on its owner's permissions rather than its own scope, so a
read-only key issued by an administrator carried more access than it was given.

Restore also holds back fields the caller is not allowed to read, rather than
writing them back unseen, and reports component values it cannot safely apply
instead of appearing to restore them: a field pointed at a different component
since the version was captured, and a component list emptied of every allowed
type.
