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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A plugin can now ask whether a collection stores a working draft beside its published row.

`schemaDraftSplit(collection)` was already how the framework itself answers that question; it
was reachable from no public entry, so a plugin had two options and both were wrong. It could
guess from `status: true` - the obvious flag, and true for collections that store no draft at
all - or it could reimplement the five conditions the split really resolves from: versioning
resolving `drafts.enabled`, `status: true`, no reachable password field, every reachable
component schema resolving, and no component carrying one.

Either way a plugin keying its own data by published/draft writes records against a document
that does not exist, and nothing downstream can tell those records from real ones. The
page-builder's class-usage index is the first case; any plugin storing anything per variant
has the same problem.

The reason travels with the verdict rather than being reduced to a boolean, so a caller can
say WHY a collection it expected to draft does not.

Published from the package root rather than `nextly/config`, because answering the question
reaches the component registry through the service container, and `config` is a client entry -
exporting it there would pull server code into a browser bundle.
