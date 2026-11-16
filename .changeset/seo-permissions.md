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

The SEO plugin now decides who changes SEO by permissions it declares. `manage-seo` is site-wide SEO: the SEO settings, redirects, their imports and the addresses not found, refused on the server to anyone without it, whatever else they hold. `check-seo` runs the check of what search engines received, which fetches the site's own pages. With the new `pagePermissions` option, each content type the plugin extends gets an `edit-seo-<type>` permission: a role that may edit a page but lacks it saves the rest of the page while its SEO stays as it was, and the SEO tab shows it read-only. Admin and Super Admin hold every one; whoever may edit a page keeps changing its SEO while `pagePermissions` is off. A redirect chain on the problem list is shown only to someone holding `manage-seo`.
