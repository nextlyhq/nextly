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

`nextly repair-columns` now waits for a table another database session is using as every schema change does: in short tries (about 5 seconds each), retried after growing pauses, up to a total (about 90 seconds), with `--lock-timeout` and `--lock-timeout-total` (or `NEXTLY_LOCK_TIMEOUT` and `NEXTLY_LOCK_TIMEOUT_TOTAL`) to change the bounds. This covers both its reads of a table (with or without `--apply`) and its conversions. Each try that ends gives the table back, so the site's own reads and writes never queue behind the command for longer than one try. A table gets one total per run, however many of its columns differ. When the tries run out, the table's columns are reported as unavailable, locked, with the tries made, the time they took, the session holding the table (on PostgreSQL and MySQL; never its query) and the next step. The command exits 2 (differences remain) and goes on with the other tables. A MySQL conversion stopped part-way by a busy table stays interrupted at the step it reached (exit 3). On PostgreSQL, a table whose definition cannot be read has every column its fields name reported once as unavailable, locked. On SQLite, where another connection holds the whole database, every table not yet read or converted is reported that way, and a database held before the command starts no longer stops it with exit 1. The notice of each try after the first goes to standard error, so `--json` still writes one document to standard output.
