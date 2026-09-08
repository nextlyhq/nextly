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

A translator can now ask what needs them, across the whole site, in one
language. `GET /api/translations?locale=es&state=missing` returns the
outstanding documents from every localized collection at once.

Everything under it already existed: a collection's list query has long
accepted a reserved `_translated` filter and turned it into a companion
EXISTS/NOT EXISTS condition, and the entry table already offers that filter on
one collection. What nobody could ask is the question spanning collections, so
finding the work meant opening every document in turn. This adds the fan-out and
reuses the filter, the SQL and the state vocabulary already in use.

Rows are read with the caller's own user context, roles included, so each
collection's stored read rules run per row. That matters more than it sounds: a
worklist is a list of titles, and filtering only at collection level — the
dashboard's model — would list every author's titles back to a role scoped to
its own entries. Passing the id without the roles would fail the other way, and
a role-based collection would report itself fully translated.

The fan-out is capped at 20 collections and the ones it left out are NAMED in
the response rather than dropped, because a worklist that silently omits a
collection reads as "nothing to do there".
