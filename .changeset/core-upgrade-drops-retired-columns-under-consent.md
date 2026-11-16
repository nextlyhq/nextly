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

A core upgrade now does what it says with retired columns, and stops cleanly where it can't finish.

**Retired core columns.** Sites stuck since 0.0.2-alpha.66 on `access_rules` get through by giving consent for the two columns: `nextly migrate --accept-data-loss=dynamic_collections.access_rules,dynamic_singles.access_rules`, or `NEXTLY_ACCEPT_DATA_LOSS` set to the same list in a deploy step. The deprecated `NEXTLY_ALLOW_CORE_DESTRUCTIVE=1` still works too. Until now that variable lifted the refusal, but the apply step left both columns in place, so every later `nextly migrate` refused again. A column a core table still has that this release no longer declares is now dropped by Nextly itself, once everything else has applied, and only when the consent covers it. Without consent, `nextly migrate` refuses before changing anything. It names each column with its count and prints the consent that covers it. At a terminal it lists the columns with your migration files' deletions and asks once. The start-up warning about stored access rules names the same consent.

- `nextly upgrade --reconcile-core` takes `--accept-data-loss` as well, and lists and asks the same way. Its old per-change prompt, and the `CORE_DESTRUCTIVE_NEEDS_TERMINAL` error, are retired.
- A type that changes or a column that becomes required on one of Nextly's own tables is covered by the same consent, named by its column.
- A database that needed a column dropped and others added on one core table (one last migrated by about 0.0.2-alpha.42) now upgrades fully. Before, it failed on PostgreSQL with drizzle's internal "HintsHandler" error, or on MySQL and SQLite reported success with the new columns missing. If drizzle-kit still cannot plan an upgrade, it stops before its first statement with `NEXTLY_CORE_UPGRADE_UNSUPPORTED`, naming the tables and the release to migrate with first. After an upgrade, every core table is checked for every column this release declares; a gap stops the run with `NEXTLY_CORE_UPGRADE_INCOMPLETE`, naming it.
- An upgrade stopped part-way is finished by the next `nextly migrate`, planned from the tables as the database holds them. On SQLite the core push now runs in one transaction, as on PostgreSQL, so a stopped run leaves nothing behind.
