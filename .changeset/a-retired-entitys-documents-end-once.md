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

A migration that deletes a collection or Single ends every one of its documents with one `deleted` history event, however the run stopped after the drop: the next `nextly migrate` finishes it, and no document gets a second event. What a migration deletes is read from its snapshot, so a migration whose snapshot says a collection or Single is deleted while its file does not plainly drop the table is refused before any statement runs, and one with no snapshot applies as it did, with a warning where it drops one. The migration written for a deletion drops the many-to-many tables of the collection or Single it deletes, unless one that stays uses the table too, and its rollback makes them again, empty; the entities they link to keep their rows and every other link. Its documents' review state goes with it. On MySQL the tables a statement drops are locked while their documents are read and they are dropped, which needs the `LOCK TABLES` privilege; without it the run says so, and a document another instance saves in that moment can be missed. A deleted collection's or Single's permissions are now marked orphaned by that migration, their grants kept, as a removed app or plugin permission is, and are live again if it is declared again. Where the run that applied the migration could not mark them, as when it was recorded applied by hand, the next `nextly migrate` does.
