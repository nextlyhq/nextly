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

Enabling localization on a collection, single or field group that already has content no longer hides that content. Previously the code-first path (turning `localized: true` on in `nextly.config.ts`) created an empty translations table, so every localized field read as empty even though the values were still in the database. Turning localization on through the admin Schema Builder always copied the existing values across; now both paths do.

The existing values are copied into the default language and left in place on the original table as well, so nothing is destroyed if you turn localization back off before running `nextly migrate`.
