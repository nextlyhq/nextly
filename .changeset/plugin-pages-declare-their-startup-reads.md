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

A plugin page can now name the data it reads as it opens, with the experimental `startupReads` on a `contributes.admin.pages` entry: reads of the plugin's own routes, each named as the page's `usePluginRoute` names it, at most four. When a tab opens on that page, the admin asks for them inside its startup request, in its first round, and the page's own read takes that answer instead of asking again. Each read keeps its route's own permission check. The admin layout carries the reads in the prebuilt page with the new `adminStartupScreensJson(config.plugins)` from `nextly/config`; the scaffolded layout writes them, and an existing app's layout can add the same element to get them. The app refuses to start if a page names more than four reads or a path the startup request cannot carry. The startup request now also accepts a plugin route under its scoped name (`/plugins/@scope/name/...`). The SEO plugin's Overview declares its setup checklist this way.
