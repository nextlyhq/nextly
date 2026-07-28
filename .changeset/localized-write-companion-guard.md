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

Turning on localization for a collection that already had content could lose that content in two ways.

Existing entries could go blank. Once the translations table existed, every localized field was read from it, and nothing had copied the current values across — so titles and body text disappeared from the admin, from lists and from filters, while the values sat untouched in the database. Those values are now copied into the default language when the table is created, so existing content stays exactly as it was. Nothing is deleted: the copy leaves the originals in place.

Saving a translation could overwrite the original language. `nextly db:sync` marks a collection as localized in a separate process from the running app, so the app could show the language switcher before its translations table existed, and saving a translation then wrote over the original-language values and changed the entry's URL while reporting success. `db:sync` and the dev config watcher now prepare that table in the same run, for collections, singles and components alike, and a translation saved before it exists is refused with a clear message instead of overwriting anything. Writing the default language before the table exists is unchanged.

Collections and singles that set a custom `dbName` are now handled correctly here too; previously their translations table could be created against a table name that does not exist. And a database that is unreachable or refusing connections is no longer reported as a missing translations table.
