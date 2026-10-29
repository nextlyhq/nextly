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

A development server now has a widget preview page. While the server runs in development, the admin offers a page (linked from customise mode's bar) that draws every widget the reader may see from its declared `preview` cases, at its smallest, default and largest sizes, in light and dark, in its ready state and in each frame state (loading, empty, error, not available), with an accessibility check beside each state. A widget with no preview case says so in place of its ready state. No widget's data is loaded. A production server neither serves the page nor its read, `GET /api/dashboard/widget-previews`, which answers there as any path it does not serve. Startup now also refuses a preview case whose settings would not reach the browser as they are, such as a date inside a filter setting.
