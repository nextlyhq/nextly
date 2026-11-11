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

The Builder's lists of collections, Singles and field groups now say what is true. A plugin's entries are listed under that plugin by name, folded by default and read-only (no selection, no delete), instead of among the site's own or as "Unknown". Each entry names its source: "Defined in code", "Made in the Builder", "Built in" or the plugin's name. The column reporting whether a schema is applied is called "Schema" and draws attention only when something is not applied. "View entries" opens the collection's entries; "Generate Types", which only promised a later feature, is gone; a code-defined entry offers no delete rather than a disabled one. Each field group shows how many fields use it.

The list endpoints for collections, Singles and field groups accept `owner=site` or `owner=plugins`, applied in the query so a page and its count describe the same rows; without it they list everything, as before. The admin's plugin metadata names a plugin's collections, Singles and field groups by the slugs a host's rename registered them under. The field-group list now reads a 1-based `page` as well as `offset`, so its second page is no longer its first.
