---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

Each translation keeps the source text it was made from:

- When a value is translated, the text it was translated from is kept in a new core table, `nextly_translation_sources`, one row per version however many languages were made from it, until no translation names that version. Run `nextly migrate` to create the table; until then nothing is kept and saves work as before. A site with one language keeps nothing. Text inside repeaters and groups is not kept yet.
- **Changed:** a save that sends a translated value unchanged, without saying where it came from, leaves that value's origin and out-of-date state as they were. Before, any save that sent the field recorded it as written by whoever saved, and as up to date.
- A translation made from a source last saved before origins were recorded can now be found out of date: the source is recorded, as of unknown origin, when the translation is made.
