---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Enabling localization while adding a translatable field in the same save no longer fails.

When a field is added and localized in one save, it is (correctly) kept off the main table and lives only in the companion `_locales` table. The companion enable migration seeded the new companion from the main table with `SELECT <all localized columns> FROM <main>` and then dropped those columns, but a field added in the same save was never on the main table, so the seed failed with `column "..." does not exist` and, on singles and components, the whole apply returned 500.

The enable migration now seeds and drops only the localized columns that already exist on the main table (fields present before this save). A field localized on creation still gets its companion column; it simply has no existing data to copy and nothing to drop.

Listing entries no longer fails after localization is toggled on for an existing collection. Enabling localization moves translatable columns off the main table, and the entry list reads its columns from the file manager's schema cache. The metadata update path refreshed only the adapter's CRUD schema, leaving that read cache holding the pre-toggle table, so the list query selected a column the table no longer had. The metadata path now refreshes the read cache as well, matching the schema-apply path.
