---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/admin": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Cache revalidation now honors a collection or single's `revalidate` config and covers every localized URL.

The `revalidate: { disable: true }` and `revalidate: { tags: [...] }` options you set on a collection or single are now persisted and applied on every write: a disabled target busts nothing, and configured tags are merged into each invalidation. Previously the options were accepted but silently ignored. For localized collections whose `slug` differs per language, publishing all locales or deleting an entry now busts every locale's page, not just the default one.
