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

Reusable field structures are now called Field Groups. `defineComponent()` becomes `defineFieldGroup()`, the `component()` field helper becomes `fieldGroup()`, the `components` config key becomes `fieldGroups`, and plugins contribute them via `contributes.fieldGroups`. The old names are removed rather than aliased, so configs must be updated on upgrade.

Stored data is untouched: tables, columns and the JSON written for existing content keep their current names, so this release moves no data and needs no migration. Table names starting with `fg_` are now rejected in `dbName`, reserving them for the storage migration that follows.
