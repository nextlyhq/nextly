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

The page builder can manage pages without leaving the editor. A Pages panel lists the site's pages with their state and a search, and opens, adds, duplicates, renames and deletes them; the page title in the top bar opens recently edited pages and "All pages…". Opening another page with unsaved work asks first. The plugin adds page routes (create, duplicate, rename, delete) that act as the signed-in author and touch only page collections, and the page search now reports each page's state and pages with a cursor. The builder shell can open Settings on a host's request (`openSettingsRequest`), the Pages rail item has its own mark, and `@nextlyhq/builder` exports `browserStore`; all additive and @experimental. The editor's search tells a host a new search with the keystroke, so results for the previous search never show under a new one.
