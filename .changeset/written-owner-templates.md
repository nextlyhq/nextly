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

A plugin's email template can be written in blocks instead of HTML; `htmlContent` is now optional on `PluginEmailTemplate`, so code that reads it as a string needs a fallback.

A plugin can contribute an email template written in blocks (`@experimental`): an entry in `contributes.emailTemplates` gives `blocks` instead of `htmlContent`. It is stored written, follows the plugin's next version until the site overrides it, and is the plugin's blocks again on Reset. An entry with both or neither, with blocks that don't pass the written rules, or with `engine: "legacy"` and blocks stops the boot, naming the plugin and the template. An owner's update to a template written in blocks on either side is offered as one change for the whole template: the site's version or the plugin's. A written plugin template the site converts to code stays coded.
