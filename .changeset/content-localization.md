---
"nextly": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/ui": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"create-nextly-app": patch
---

Add content localization (multilingual content) for collections, singles, and components.

Configure an app-level `localization` block (locales, default locale, per-locale fallback and RTL), then mark collections or individual fields `localized`. Translatable fields move into a companion `<table>_locales` table (text-like fields localize by default; opt out per field), so each language stores its own value while the main row keeps shared fields. Reads resolve the requested language with a configurable fallback chain (`?locale=`, `?fallback-locale=`); `?locale=all` returns a language-keyed object per field. Writes target a language with `?locale=`, leaving other translations untouched. Where filters, search, and sort work against localized fields, and on draft-enabled collections each language carries its own publish status, so a published read never surfaces a draft translation.

The admin gains a language switcher, per-language translation-status pills and a list completeness badge, a copy-from-language action, inline source-language hints while translating, RTL-aware field rendering, and a `_translated` list filter. `nextly migrate:create` emits companion migrations that relocate localized columns while preserving existing default-locale content.

Non-localized apps are unaffected: without a `localization` config the read/write paths, schema, and admin behave exactly as before.
