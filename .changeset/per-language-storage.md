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

Add `experimental.perLanguageStorage`, a boot-time choice to keep every translatable field in its per-language table from the start, for every collection, Single and component, whether or not it is marked translatable. Off by default.

- A site that declares no languages has one implicit language (English) while the setting is on, so adding a language later is data only.
- Code-first and Schema Builder entities, migrations, development reloads and the dev server lay tables out the same way. Reads, writes, relationship population and unique fields go through the per-language table.
- A database whose main tables still hold translatable values is refused at boot with `NEXTLY_PER_LANGUAGE_STORAGE_MIXED`, naming each table and its columns. A reload that would turn the setting on or off is refused until the site restarts (`NEXTLY_PER_LANGUAGE_STORAGE_CHANGED`). A site that declares no languages, in its configuration or in Settings, is refused at boot while its per-language tables hold translations in other languages than the implicit English (`NEXTLY_PER_LANGUAGE_STORAGE_LANGUAGES_UNDECLARED`), naming them: put the `localization` block back, or add those languages in Settings, then restart.
- A populated related entry now carries its translatable values from its per-language table, on translated collections too.

The setting is `@experimental`: it may change or be removed in a later release.
