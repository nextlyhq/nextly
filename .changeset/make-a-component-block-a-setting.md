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

A placed component's panel can turn one of its text, link or image blocks into a new setting of the component, bound to a field for this placement, from "Make this a setting of the component" below its settings. The canvas shows the bound data at once. The component's draft gets the new setting with the page's next Save, or when you leave for the form. A Publish of a page using a setting its live component lacks asks first whether to publish the component too, saying that its other unpublished changes go live with it. Other pages that place the component keep showing what they show now. If the component can't take the setting, for example because someone else changed it since, the binding is taken off this page, the Save stops, and a message says why, with **Save again** to save the page without it.

The component definition route (`POST /components/:id/definition`) takes an optional `locale`: where the component store translates its definition field, the edit reads and writes that language.
