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

Refuses to run a schema sync while a field group storage migration is in flight. Mid-run some tables carry their old names and some their new ones, and the registry rows pointing at them move one step at a time, so a sync during that window could delete storage it could not account for.

Also further groundwork for that migration: it can now execute its rename steps and check its own work. Each table rename carries the registry row that points at it, so the two cannot land apart, and every step verifies against the database rather than trusting that it ran. Index survival is checked by name, so an index dropped and replaced by another is caught rather than passing on an unchanged count. Nothing calls the migration itself yet.
