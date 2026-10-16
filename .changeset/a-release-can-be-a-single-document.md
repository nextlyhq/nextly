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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
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

A release now has a kind: `release`, the default, or `single`, a document
scheduled on its own. Pass `kind` to `nextly.releases.create()` or
`POST /api/releases`, and read it on every release. A single-document release
holds exactly one document. The database refuses a second one, even when two
requests add documents to it at once, with a conflict that says to use an
ordinary release instead.

`find()`, `count()` and `GET /api/releases` take a `kind` filter: `release` leaves
out single-document releases and `single` lists only them. It filters on the
stored kind, never on how many documents a release holds.

`nextly migrate` adds the `kind` column (existing releases read as `release`) and
a `single_slot` column on release documents with its unique index. No row is
rewritten. `kind` is experimental.
