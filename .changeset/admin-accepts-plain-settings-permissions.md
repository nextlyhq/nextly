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

The admin accepts the plain settings and email permissions. Settings pages are shown on `read-settings` and used on the permission their action names: creating an image size or a user field asks `create-settings`, editing one `update-settings`, and the plugins area any settings change. A role that may only read settings sees General, Image Sizes and User Fields read-only: it is offered no save, add, edit, delete or reorder it would be refused. A role still holding `manage-settings`, `manage-email-providers`, `manage-email-templates` or `manage-media` keeps every page it had, since the admin counts each as the plain read, create, update and delete it stands for, as the server does. A plugin that names no settings permission of its own now asks `update-settings` (before, `manage-settings`, which still counts as it).
