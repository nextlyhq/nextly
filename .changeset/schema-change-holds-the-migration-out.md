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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A Schema Builder change to a single or a field group now holds the field-group storage migration out for its whole duration, rather than being able to start one halfway through. The exclusion is taken before the change plans anything, so a create, an update or a delete either runs against storage nothing is renaming or is refused
outright — and a change that is refused has written no row and built no table of its own. Taking
the exclusion can still create the migration lock's own table, which is empty, holds no content,
and would have been created by the next successful change anyway. A database that has never run a migration is covered too: these paths may create the lock table, so a first migration cannot claim it and start renaming underneath a change already in progress.

Not every way of changing schema is covered yet. The Admin's confirmed apply, the standalone
schema routes, collections and user fields still write without the exclusion, so they can run
alongside a storage migration.
