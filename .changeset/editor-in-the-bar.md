---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

An open entry or Single draws no bar of its own: its status, save state and actions (History, Preview, Save or Publish with its arrow, More, the panel toggle) are drawn in the admin's one top bar, after the breadcrumb, on one row at every width. Editor pages run edge to edge: the scheduled, lock and recovery banners start directly under the bar, and the side panel meets the window's edge. Singles are drawn as Editor pages, with their fields in the same 72rem column as an entry's and no cap on the page. A plugin's custom edit view keeps the page gutter without a width cap. The shared `PageFrame` from `@nextlyhq/ui` draws `type="editor"` with no gutter and no padding.
