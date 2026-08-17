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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Two paths that change field-group storage now hold a storage migration out while they run.

A field-group storage migration renames the registry table and every field group's data table. Two paths could previously run at the same time as one: the code-first sync that materialises field groups defined in your config at boot and on hot reload, and the `db:sync` pass that deletes field groups no longer present in code.

The deletion pass was the more consequential of the two. It reads the table names first and then drops them one at a time, so a migration renaming those tables partway through left the remaining drops addressing names that no longer existed. Because those statements are `DROP TABLE IF EXISTS`, that failed silently: the field group survived as a table nothing scanned for again. The exclusion is now held across the whole pass rather than per field group, so the names it read stay valid until it finishes.

The code-first sync writes definition rows only and creates no tables, so it holds the migration out without being able to create the lock itself — a deployment whose database role has permission to write rows but not to create tables keeps booting exactly as before.

Neither path changes what it does when no migration is running.
