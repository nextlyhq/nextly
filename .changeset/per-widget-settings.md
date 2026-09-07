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
"@nextlyhq/plugin-form-builder": patch
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

A dashboard widget can declare `settings` — what a reader may change about that card — and a reader's stored choices now reach the query the card asks. Settings are declared as field definitions, so the admin draws them with the renderer it already has and a plugin author needs no new vocabulary.

A setting named `limit` and typed `number` sets how many rows its card asks for. Anything a widget does not declare is ignored, and a stored value the declaration no longer recognises falls back to the declared default rather than breaking the card.

`WidgetSetting` is exported from `@nextlyhq/plugin-sdk`, and `contributes.admin.widgets` accepts `settings`, so a plugin declaring one can name its type. The same card placed twice keeps its own settings and its own data.
