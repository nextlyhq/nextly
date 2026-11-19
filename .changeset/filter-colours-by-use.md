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

The Design panel's Colours tab can be filtered: "All", "Unused" and "Used on this page", as pills above the list. "Unused" lists the colours nothing the site stores uses (a page, a component, a shared or block style, or another variable naming it); a colour only a core block's built-in look uses counts as unused. While the site's usage count is not whole, "Unused" claims nothing and says "Counting usage…". "Used on this page" lists what the open page and the components it places use, and follows an edit at once, before any save. The walk over a document's variable references moves into `@nextlyhq/blocks-engine` (`documentTokenUsage`, `@experimental`), so the editor and the usage index read a page the same way.
