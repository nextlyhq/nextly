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

`MAX_ATTENTION_ITEMS_PER_PLUGIN` is now exported from `nextly` and from `@nextlyhq/plugin-sdk`: the most Needs attention items one plugin may declare, which startup holds every plugin to. It is intended to be stable, so a plugin with a line per collection it reads builds no more than this instead of restating the number; `@nextlyhq/plugin-seo` now reads it from the SDK.

The SEO plugin's Needs attention lines now share one scan budget for each answer of the Needs attention card, rather than one each: ten large collections read at most one budget's pages between them on a dashboard load, and a line left short of the end says its count is a floor.
