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

A past version now reads in the editor's own layout with its changes marked. One comparison bar above it says which version is shown, what it is compared with (the version before it in its language) and how many fields changed, with Previous and Next change. Each changed field is marked with what changed; unchanged fields fold behind "Show N unchanged fields". While a version is shown, Back to current and Restore… replace Save and Publish in the title bar, and on a phone they sit in a bar at the bottom. The banner above a past version is gone.

The admin's unused localStorage autosave and draft recovery (`useAutoSave`, `useDraftRecovery`, `DraftRecoveryDialog`) are removed. Nothing called them since autosave moved to the server, and none was exported from the package.
