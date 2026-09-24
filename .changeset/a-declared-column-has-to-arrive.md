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
"@nextlyhq/plugin-mcp": patch
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

A column declared against a table you do not own had nowhere to arrive.
`extendTable({ columns })` validated it, marked it hidden, recorded who
contributed it, and collected it into a map nothing read — so it reached no
table spec, was never created, never appeared in a runtime Drizzle table, and
did not even move the schema fingerprint. The one test covering it asserted
the half that worked.

Contributed columns now reach the desired spec for collections, singles and
components, reach the runtime table, and are stripped from every entry: a
column on the table is a column `select()` returns, and this one belongs in no
REST response, version snapshot or webhook payload. Core tables get the
runtime and strip halves; creating one there belongs to the contributor's
migration stream, because core tables are migration-owned.

`contributes.transform` lets a plugin change entities another plugin declared,
not only add fields to them — the thing `setup(config)` cannot do, because it
runs before plugin schema contributions are merged and never sees them.
Transforms run after the merge, in dependency order, each handed a frozen
copy.

A collection can choose how its ids are made and whether a caller may supply
one: `db.idType` picks between random and time-ordered UUIDs, and
`db.allowIdOnCreate` accepts an id from the request, validated to the version
the collection generates. Storage is untouched either way.

`col.serial()` declares a database-assigned key, and `col.enum([...])` now
enforces its values — as a CHECK constraint, which is the one mechanism
PostgreSQL, MySQL and SQLite all have. Adding a value is an ordinary
constraint change; removing one is refused while a row still holds it.

`db.postgres.schema` puts every managed table, the migrate lock and the ledger
in one PostgreSQL schema, applied as `search_path` so it covers SQL that never
went through the query builder. MySQL and SQLite warn and ignore it.
