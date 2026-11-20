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

`nextly migrate` checks a translations table before it applies the files `migrate:create` wrote for it. The table is compared with what the migrations around that point record of it: a translations table, or a translated column, that both the last applied and the newest pending migration name and the database lacks, is reported as drift. A column's type is not compared. The refusal names the file, the table and each difference, says what to do about it, and nothing is applied. A column no migration names is left alone: a translated field deleted from the config leaves its column behind. These files are no longer announced as applied "without drift checks". Where the migrations do not record a translations table's columns, so there is nothing to compare it with, its files are applied and one line says why. A migration written by hand, which has no snapshot, is still said to run without drift checks.
