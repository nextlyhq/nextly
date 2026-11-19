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

A translated collection, Single or field group deleted in the Schema Builder, or a translated code-first collection removed from the config, is now deleted on a deployed database by `nextly migrate` with its translations table. The migration file drops the translations table first, then the entity's table. Before, the file dropped only the entity's table: on SQLite and MySQL the deploy failed at that drop, since the translations table still referenced it, and on PostgreSQL the translations table and every translation in it were left behind. `migrate:down` of such a delete brings back the table with an empty translations table.

The data-loss consent counts a table's translations table as part of it: `--accept-data-loss=dc_posts` also covers `dc_posts_locales`, and the listing names each translations table right after its table.
