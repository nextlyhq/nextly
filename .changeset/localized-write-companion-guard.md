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

Saving a translation could overwrite the original language. `nextly db:sync` marks a collection as localized in a separate process from the running app, so the app could show the language switcher before its translations table existed — and a translation saved in that window wrote over the original-language values and changed the entry's URL, while reporting success.

The translations table is now prepared during `db:sync` and during a dev config reload, for collections, singles and field groups alike. If it is still missing, a write in a non-default language is refused with a clear message instead of overwriting anything, and the same refusal now covers singles and embedded field groups rather than only collections.

Writing the default language before the table exists still goes to the main table as before. The one exception is content that was localized from the start, whose translatable values have never had a main-table column to fall back to: saving that while the translations table is missing used to fail with a database error, and now reports the same clear message as the case above.

Collections and singles that set a custom `dbName` are handled correctly here too; previously their translations table could be created against a table name that does not exist. And a database that is unreachable or refusing connections is no longer reported as a missing translations table.
