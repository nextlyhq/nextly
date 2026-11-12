---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/builder": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
"create-nextly-app": patch
"nextly": patch
---

`nextly migrate:down` now keeps the registry in step with the database once the database has its registry record. A rollback that brings the database back to the point that record was taken at undoes the rolled-back migrations' own changes to the bookkeeping, in the same transaction as the last migration it rolls back: each collection, Single and field group row goes back to how it stood when the record was written, the row of an entity those migrations added is removed and its permissions marked as no longer declared, a permission they added is marked the same way with its grants kept, and a permission they marked is declared again where that point declares it: the app's own, an entity's or Nextly's where the baseline holds it, and a plugin's where the plugin is installed and its current release declares it. What plugin installs and uninstalls wrote in the meantime, and Nextly's own permissions, stay as they are. A rollback that would leave the database at any other point where nothing records the registry (an earlier migration without the registry metadata, or the point before any app migration when the record is not there) is now refused before it changes anything, naming that point; write a new migration to undo the change instead. On MySQL, where schema statements commit as they run, a rollback whose bookkeeping cannot be written is left recorded as a failed rollback rather than as rolled back.
