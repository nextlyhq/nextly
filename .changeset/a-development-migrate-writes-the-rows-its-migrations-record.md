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

A `nextly migrate` run in development mode, which is how it runs when `NODE_ENV` is not set, now writes the registry rows its migrations record. On a fresh database it adds every collection, Single and field group row the newest applied snapshot records, and it brings the row of each entity an applied migration changed to that migration's record, on a later run too when the run that applied it could not write the row. Before, it added only the rows an older template-shaped snapshot listed, so a site migrated with `migrate:create` files had no registry rows until a development start synced them. Rows a live sync edited with no migration for the edit are still left as they are.

A run in any mode also adds the rows a template's older-format snapshot lists (the blog template's hand-written migration), where the registry lacks them. Outside development such a snapshot was read as unreadable, so a site built from it got none of those rows from `nextly migrate`. A snapshot that cannot be read for another reason is still refused.
