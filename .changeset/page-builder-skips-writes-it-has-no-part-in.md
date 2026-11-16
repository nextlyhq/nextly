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

The page builder no longer reads or writes anything on a write it has no part in. A save to a collection the site's code declares that no template can serve and that holds no blocks field, such as another plugin's private records, no longer reads the templates, writes a lock row to the address store or reads the component registry, so each such save costs several fewer database round trips.

The composition graph lock's row is now put in place once, by the plugin's migration, on install and on `nextly migrate` for an existing install, instead of at every start. A start on PostgreSQL or MySQL no longer sends an insert that fails on a duplicate key. Run `nextly migrate` after upgrading; until then the first page-builder write that locks the graph inserts the row, as before.
