---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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

The compound indexes a collection declares (`indexes` in `defineCollection`)
now reach development push, not only `migrate:create`.

A hot reload, `nextly db:sync` and the boot that creates a missing collection
table all built the collection without its declared indexes. So a dev push
never created one, a declared unique index enforced nothing, and on a database
where a migration had created the index the next push planned to drop it; on
SQLite a table rebuild lost it outright. The boot drift warning and the schema
preview read the collection the same way, so they reported a migration-created
index as a change. Each of them now carries the declared indexes, and an edit
that only adds or removes one is applied by the next reload.

The schema preview (the admin's confirm step and the boot drift warning) now
builds the schema it compares from the same function as the apply, with the
tables plugins and the app declare and what schema hooks add to entity tables.
It used to leave those out, so it showed a hook-contributed column as one to
drop and a declared table as nothing to create, neither of which the apply
does.
