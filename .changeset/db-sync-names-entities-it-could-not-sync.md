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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
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

`nextly db:sync` no longer reports an entity as synced when the database refused a column or a table it needs. Each such Single or field group is recorded failed and the rest of the run goes on; the run then ends with `ENTITIES_NOT_SYNCED`, naming each entity with the column or table refused and the reason, and exit code 1. A failed table creation now ends the same way. **A run that exited 0 before, printing only a `Failed to add column` warning, now exits 1**, so a CI or deploy step stops where the schema did not come into step.

In such a run the steps over data an earlier release stored are not taken, and the run says so, naming the passwords still stored as given; the next run that syncs every entity takes them. With `--watch`, the first sync and each re-sync report the error and the watch goes on; a re-sync never takes those steps. The next `db:sync` tries every entity recorded failed again, also when its configuration did not change, and records it applied once its table is in step.

A development start whose plugin field on a Schema Builder collection, Single or field group the database refused no longer records the field without its column, after which every read and write of that type failed with `ENTITY_NOT_MIGRATED` and no later start tried again. The start warns, naming the type, the column and the reason, serves the type without the field, and tries again at the next start. A type an earlier release left that way is brought up to date by the next `nextly db:sync`.
