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

Every translated value now records where it came from, field by field and per language: written by a person, an API key (an integration) or the system (an import), or as a write claims it under the experimental `_provenance` key (a machine translation with its engine, an agent, a copy from another language, or a value written originally in its language). Each translated value keeps the fingerprint of its source language's value at that moment, so the translation overview (`translationStatus`) now reports each field as out of date once its source changes (`fields`, experimental), and a language is stale exactly when one of its fields is. Values written before this, or on a site that has not run `nextly migrate` for the new `nextly_translation_provenance` table, are judged by the language-level timestamp as before.
