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

`nextly plugins uninstall` now refuses to run its DOWN migrations when the
plugin's `onUninstall` replaced one of the tables they drop by renaming it
away and creating another under its name. Before, only
the name was checked, so the approved drop took the replacement, and the
original table and its rows survived under the other name while the plugin
was recorded uninstalled. Each table is now identified by what the database
keeps for it (its oid on PostgreSQL, its creation time on MySQL, its root page
on SQLite), read before the hook's boot and again after the hook. On MySQL the
creation time has one-second resolution and changes on any `ALTER TABLE`, so a
hook that alters one of those tables is refused, and a replacement created
within the same second as its original is not detected. On SQLite, where a root page can
be given to a new table, a hook that changes the schema at all is refused
too. The refusal comes after `onUninstall` has run but before any DOWN
migration, so no table is dropped and every module is still recorded as
applied. A table whose identity can't be read is refused before the hook
runs.

A disabled plugin's transform that moves a field into another group or tab
keeps that field's access rule even when the collection has an index with the
same name as the field. Only fields are now matched by name.
