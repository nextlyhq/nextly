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

A `db:sync` on an existing SQLite database no longer recreates the field-group
registry a migration moved away from.

The bootstrap replay added for existing databases ran every statement, including
`CREATE TABLE IF NOT EXISTS "dynamic_components"`. On a database whose registry
has been migrated to `dynamic_field_groups` that does not add a spare table:
`chooseRegistryTable` prefers the legacy spelling whenever it is present, so
every subsequent read and registration switches to the empty one and every
migrated component becomes unreachable.

The replay is now narrowed for an existing database — the legacy registry and
its five indexes are dropped when the migrated spelling is there — while a
fresh database, which has chosen neither, still gets the full set. The probe
fails closed: if it cannot tell, it assumes migrated, because skipping a create
on a database that did not migrate costs a table the fresh path adds, while
creating one on a database that did is silent.
