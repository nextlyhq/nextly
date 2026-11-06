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

Every collection entry and every Single now has a version. Every save changes it and no read does, and every read and write returns it as `_rev` (experimental). It is an opaque string. Two saves within the same second still differ. Each translation keeps its own counter, so saving one language does not change the version a reader of another language holds. A client that sends `_rev` back with a save has it ignored; before, such a save failed.

Existing sites get the new columns from `nextly migrate`, on its usual run and on the boots that run it: a version counter and the last changer's ids, on every content and translation table. Existing documents start at version 1 with no recorded changer. No content and no `updated_at` is rewritten, and running it again changes nothing. A development boot of a project without a migrations directory adds them too. These columns never appear in a migration file, `migrate:check` or a drift report.
