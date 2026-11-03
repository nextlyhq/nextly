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

`nextly plugins uninstall` now refuses a full uninstall while another owner has built on
the plugin's schema, instead of dropping it after consent. That covers a column, index,
foreign key or check the app or another plugin added to the plugin's tables, a key or a
relationship field pointing into them, and an index or key using or referencing a column
the plugin added to someone else's table. Dropping these would delete data that belongs to someone else.
Each is judged by the definition the database holds, so one whose declaration changed in code
but was never migrated still counts while the database's definition uses the plugin's schema.
The refusal names each one and its owner. Remove them in their owner's code and migrate,
or uninstall with `--keep-data`, which drops nothing.

A full uninstall now also deletes the plugin's settings (secrets included), its owner
records and its migration history, so a later install applies every module again. It does
so only once its DOWNs have removed everything it added to other owners' tables; if one is
left, it keeps them and refuses, and the uninstall can be run again once it is dropped. The
record that it was uninstalled stays, and the boot still refuses the plugin until it is
removed from the config or installed again.
