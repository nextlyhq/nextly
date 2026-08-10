---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
---

Polish version history for localized and restored content, and give the Schema Builder control over retention:

- **Filter version history by locale.** The history panel now shows a language badge on each version and a locale filter (defaulting to all locales), so a localized document's history is legible instead of interleaved. The filter is added to both list surfaces (the REST route and the dispatcher) and hides automatically for non-localized documents.
- **Show restore lineage.** A version created by restoring an earlier one now displays a "Restored from vN" chip on its row and in its preview, so a rollback is visible at a glance.
- **Set version retention in the Schema Builder.** The versioning toggle's Advanced tab gains a retention control — keep all history, keep the default (50), or keep the last N per document — reaching parity with code-first `versions.maxPerDoc`. The value persists through the builder's create/update endpoints and the committable `ui-schema.json` manifest.
