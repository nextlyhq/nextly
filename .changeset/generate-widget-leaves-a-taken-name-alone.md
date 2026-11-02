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

`nextly generate:widget` leaves a config as it was, and prints the import to add, when the widget's name is already taken there: by a declaration of the config's own (`const openOrders = defineCollection(...)`), or by an import that is not the generated named export, such as a default or aliased import of the widget's file, which a `--force` regeneration would otherwise have left pointing at an export that no longer exists. A plugin's admin entry is read the same way before the card's export is added: its own export, however formatted, is kept, and the name exported from another module is left for the author. `--config` must name a file inside the project the command runs in, following links, so another project's config is no longer edited alongside this project's manifest. `--dry-run` says which dependencies a run would add rather than to install ones it has not added. The paths it prints, the test to run among them, use forward slashes on Windows too, as the imports it writes already did. `createTestNextly` puts `DB_DIALECT` and the generated `NEXTLY_SECRET` back when its default SQLite adapter cannot be created, as it does when a boot fails.
