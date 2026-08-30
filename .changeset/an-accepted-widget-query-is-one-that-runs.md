---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
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

The dashboard widget contract promised that an accepted query is one the
executor will run, and three ways of accepting a query that could not run, or
that ran differently from what it said, are closed.

A geographic `count` was accepted and then refused at execution: geo predicates
are evaluated over rows a count never fetches, so validation now refuses the
combination rather than letting it fail in its batch slot. An explicitly empty
`select` read as "no fields" and produced a full document, because a selection
is applied only when it has keys; it is now refused, the way an empty `where`
combinator already was. And a plugin `setup` transformer could contribute an
admin widget carrying a value JSON cannot encode: the resolver validated only
the list it was handed, so the widget reached `/api/admin-meta/workspace` and
failed that request for every admin.

Rebuilding the collection sources is also all-or-nothing now. Two fields that
flatten to one name -- which an unnamed layout group can produce without its
author writing a duplicate -- used to abort the rebuild after the previous
sources had already been deleted, leaving widgets that had worked a moment
earlier answering "unavailable source". Duplicates are resolved to the first
declaration, and a rebuild that fails anywhere leaves the previous set standing.

The admin's `PluginWidgetMeta` is derived from the server's declaration through
`nextly/config` rather than restated, so the two can no longer describe the same
payload differently.
