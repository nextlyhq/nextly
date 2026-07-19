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

Extend content localization to singles and embedded components, and make disabling localization recoverable.

Singles and components now localize the same way collections do: mark a single or a component `localized` (in code or the Schema Builder) and its translatable fields move to a companion `_locales` table, with per-language reads and writes (`?locale=`, `?fallback-locale=`), a per-language switcher, and RTL-aware editing. The push pipeline provisions each companion table out of band and keeps the translatable columns off the main table, so a boot-time code-first sync no longer re-adds them.

Turning localization off is now guarded. `nextly migrate:create` emits a migration that archives every non-default translation into `nextly_i18n_archive` before dropping the companion, and `nextly i18n:restore` replays an archive back onto the companion, so a mistaken disable is reversible rather than a silent data loss.
