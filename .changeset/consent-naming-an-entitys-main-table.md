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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

`nextly migrate`, `migrate:down` and `migrate:create` now read a data-loss
consent that names a collection's or Single's main table, the table its
registry entry names, as covering the rest of that entity too. That means the
other tables it owns (its translation table and its junction tables) and its
rows in tables every entity shares: its field-group values, its archived
translations, its autosaves, version pins and "seen" markers, its readers'
dashboard pins, the record of the media its documents use, and its documents'
review state. `--accept-data-loss=dc_posts` is enough for a migration that
drops `dc_posts`, `dc_posts_locales` and its junction tables. Naming a shared
table still covers every deletion in it.

Before the consent is given, the run lists each of those tables with its row
count, and each shared table with the number of that entity's rows in it,
under the migration that drops the entity.

**Compatibility, the data-loss consent:** a consent naming an entity's main
table now also covers the other tables that entity owns and its rows in shared
tables, and covers no table or row of any other entity. A run whose consent
names one of two entities it drops is still refused before anything changes,
naming the other. A table belongs to an entity only when its registry entry
says so; a plugin's entities are not covered this way.
