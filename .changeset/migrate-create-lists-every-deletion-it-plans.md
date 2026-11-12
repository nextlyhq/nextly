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

`nextly migrate:create` now lists every table and column a migration would delete before it writes the file: a collection, Single or field group no longer in the config, a removed field, or a rename declined into a drop and an add. Where the database can be read it adds row counts and each column's count of non-empty values; it opens the database read-only and needs none. At a terminal it asks, and a no writes nothing. A run that cannot ask (CI, `--non-interactive`) now writes nothing and exits 1 unless `--accept-data-loss` (or `NEXTLY_ACCEPT_DATA_LOSS`) covers every deletion, where it used to write the file and exit 0; the refusal prints the exact consent to pass. A file that deletes data carries a `-- Destructive:` line and one `-- Deletes:` line per table and column in its header, Schema Builder files included.
