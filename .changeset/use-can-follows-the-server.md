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

`useCan` and `<Can>` (exported by the admin and re-exported by `@nextlyhq/plugin-sdk`) now answer a read, create, update, delete, publish or unpublish of a collection or Single as the server decides it, code access rules included. `useCan("update-posts")` is `false` for a role that holds `update-posts` when a code rule on Posts refuses that update, and `true` where the server allows an action no permission names. The entry editor's publish and unpublish, bulk publish and unpublish, publishing every language, adding to a release and restoring a version follow that answer. Until the server has answered about collections and Singles, such a slug answers `false`. Every other slug (a system resource such as `read-webhooks`, or a plugin's own permission such as `manage-seo`) is still answered from the permissions your roles hold. The server still enforces every request either way.
