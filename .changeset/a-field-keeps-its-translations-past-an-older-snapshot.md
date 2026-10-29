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

A field moving between translated and shared keeps its values when the latest snapshot was written before snapshots recorded which fields are translated. Every snapshot now says that it records them (`translatedFieldsRecorded`), so one with no translated table is no longer mistaken for an older one. For an older snapshot, `nextly migrate:create` reads the translated fields from the localization migration files when they record them. When nothing records them, it refuses a change that could move a field, including a shared field added to a translated entity and turning a whole entity's translation off, names the fields, and writes nothing. The new `nextly migrate:create --record-snapshot` writes a migration that changes nothing, whose snapshot records the translated fields, so the change can go through after it. Before this, a field leaving translation lost its values, and one joining translation was handled as the whole collection becoming translated.
