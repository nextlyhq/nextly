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

`nextly migrate:field-groups --apply` keeps a live site's field-group content safe while it runs and after it.

- **A running server finds the moved storage.** A server that started before the migration, and was never restarted, finds the renamed tables, column and registry on its next read. A read returns the group's content, never an empty group. A save that meets the storage moving is refused with `FIELD_GROUP_STORAGE_MOVING` ("The field-group storage migration is running or has just run. Retry the save once it ends.") and succeeds when retried. Nothing is written under an old or half-renamed name.
- **The command warns before applying** that saves may be refused while it runs. When it ends, it says whether any running server must restart; none needs to.
- **Live traffic no longer stops the run.** Content saved during the run, under the key its writer knows, is rewritten in one more pass or left as written. The run finishes in both directions.
- **A run stopped part-way is finished, not restarted.** If a run is killed or loses its connection, the next preview reports the stopped run and where it stopped. The next `--apply` finishes it from the names and rows the database holds, renaming nothing twice.
- **It runs only when an operator runs it.** No start, `nextly migrate` or deploy step runs the migration.

**Compatibility — field-group storage on a live site:** documents keep the `_componentType` key in API responses on every site. Version and event rows a site writes after the migration keep that key too; readers accept both spellings. No code change is needed. An operator can run the migration on a live site and needn't restart servers afterwards.
