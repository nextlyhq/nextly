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

Enabling localization on a collection that already had content could silently overwrite the default language. `nextly db:sync` flips the collection to localized in its own process, so a running app could believe the collection was localized — showing the language switcher — before its translations table existed. Saving a translation then wrote over the original-language values and changed the entry's URL, while reporting success.

`db:sync` and the dev config watcher now create the translations table in the same run, for collections, singles and components alike. If that table is somehow still missing, a write in a non-default language is refused with a clear message instead of overwriting content. Writing the default language before the table exists is unchanged.
