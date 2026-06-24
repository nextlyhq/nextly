---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Stop collections from generating orphan Drizzle `.ts` schema files.

Creating or updating a collection (via the admin UI or `nextly db:sync`) used to write a Drizzle `.ts` schema into `src/db/schemas/dynamic/` and maintain an `index.ts` barrel. Nothing imported these files: the runtime resolves each table's Drizzle schema from the `dynamic_collections` metadata via `generateRuntimeSchema`, exactly as singles and components already do (those never generated `.ts` files). The only consumer was the raw `drizzle-kit` binary via `merge-schemas` / `drizzle-kit-entry`, which requires a `drizzle.config.ts` that the framework's own commands never invoke. The generated files therefore drifted from the database and read as dead code.

Collections now behave like singles and components: the data table is created, the field definitions are stored in `dynamic_collections`, an in-memory runtime schema is registered, and the SQL migration is still written to `src/db/migrations/dynamic/` (it remains the durable DDL applied by `nextly migrate`). No `.ts` schema file is written.

Changes:

- `CollectionFileManager`: replaced `saveArtifacts`/`saveUpdateArtifacts` with a migration-only `saveMigration`; removed `updateSchemaIndex`, `removeFromSchemaIndex`, and the disk-based `reloadSchema` hot-reload.
- `CollectionMetadataService`: create/update/delete now persist only the SQL migration. The update path relies on the existing `registerRuntimeSchema` call to refresh the in-memory table, so no on-disk reload is needed.
- Removed the now-unused `generateSchemaCode` Drizzle code generator from `DynamicCollectionSchemaService` and the `schemaCode`/`schemaFileName` fields from `CollectionArtifacts`.
- `nextly db:sync --schemas` no longer writes Drizzle `.ts` files; the flag now only generates Zod validation schemas.

Also removed the unused `NEXTLY_SKIP_SCHEMA_FILES` environment toggle (it was set nowhere and only gated the now-removed file writes).
