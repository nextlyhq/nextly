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

The registry's `CREATE TABLE` is no longer replayed at all. Its five indexes
are, retargeted to whichever registry the database actually holds — an
installation created by the older fallback has none of them, and the rename
carries that gap across, so `db:sync` still reconciles them. A registry that is
genuinely absent is created by the system-table service, which resolves the
spelling before creating rather than writing a fixed name.

Which registry a database holds is resolved once, through the same catalog
resolver its readers use, and applied to both the fresh push bundle and the raw
DDL — so a database holding a migrated registry and no `users` table cannot have
the legacy spelling created for it by either path. When resolution cannot say,
neither path names a registry: a CREATE is additive and nothing undoes it.
