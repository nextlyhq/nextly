---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Every admin list now takes its column policy from one hook instead of ten
hand-written copies.

The policy is small but load-bearing: some columns are pinned and never offered
to the toggle, the reader's choice is remembered per list, and a column is
hidden exactly when the remembered choice says so. Ten surfaces carried the
same three decisions written out by hand, each copy free to drift. The new
`useTableColumns` hook owns the policy once, and the ten entity lists — API
keys, collections, field groups, plugins, roles, email providers, email
templates, singles, users and image sizes — now declare their storage key,
their columns and their pinned set, nothing more.

Stored column choices are untouched: every list keeps the storage key its
readers already have choices under, so nothing anyone has hidden comes back.

The image sizes list also stops rebuilding its pinned-column set on every
render. The set now lives at module scope like every other list's, which
removes the last arrangement that could have been one refactor away from a
render loop.
