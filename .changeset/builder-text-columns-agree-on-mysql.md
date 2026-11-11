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

`nextly migrate:check` no longer reports drift right after `nextly migrate:create` for a Schema Builder collection on MySQL. The check described a Builder collection's table by the code-first column rule, so a text field that states no width was expected as `varchar(255)` while the migration had created it as `TEXT`.

`nextly migrate:create` now also describes Builder Singles and field groups by the column rule of the Builder that builds them, as `nextly migrate` and the running app already do. On MySQL, an app whose earlier migrations created such a column as `varchar(255)` gets, at its next `nextly migrate:create`, one migration that widens it to `TEXT`; the widening needs no confirmation and keeps every value. A unique text field that states no width stays `varchar(255)` on MySQL for every Builder entity, since MySQL can key only a bounded column; such a field is now accepted there instead of refused. So on MySQL, turning Unique on or off for a text field with no `maxLength` changes its column (`varchar(255)` while unique, `TEXT` otherwise), and the Schema Builder takes it through its schema preview as a change to the table; give the field a `maxLength` to keep its column as it is. An indexed one is not widened either: where an earlier migration made it `varchar(255)` with an index over the whole column, `nextly migrate:create` refuses with a message naming the column, and asks for a `maxLength` on the field or for its index to be removed. Widening such a column together with its index comes later.
