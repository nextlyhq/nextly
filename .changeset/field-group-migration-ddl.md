---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Fixes PostgreSQL index introspection reading indexes from the wrong table. Table names are unique per schema rather than per database, so a table with the same name in another schema had its indexes merged into the one being inspected. That could hide an index that needed creating, or report one that was never there.

Refuses to run a schema sync while a field group storage migration is in flight. Mid-run some tables carry their old names and some their new ones, and the registry rows pointing at them move one step at a time, so a sync during that window could delete storage it could not account for.

Also further groundwork for that migration: it can now execute its rename steps and check its own work. A table, its localization companion and the registry row pointing at them move as one step, and on PostgreSQL and SQLite they commit together. MySQL applies a schema change as soon as it is issued, so there the halves land in sequence and a resume completes whatever did not; a reader in that window sees a table as missing rather than reading anything wrong. Every step verifies against the database rather than trusting that it ran, and index survival is checked by name, so an index dropped and replaced by another is caught rather than passing on an unchanged count. Nothing calls the migration itself yet.
