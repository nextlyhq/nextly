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

Page Builder: the Layout picker names the site default plainly. Its first option reads "Site default", with the default Layout's name beside it in muted text, and the line under the picker says why a Layout applies ("Follows the site default, Main, because this page doesn't choose its own Layout."). A new site's own default Layout is now called "Site layout" (address `site-layout`); a site set up earlier keeps "Default (site)", since stored titles are never renamed.

Admin: the entries list no longer picks a field the form hides (`admin.hidden`) as one of its automatic columns, so the Pages list loses its "No header or footer" column. The field is still offered in the column picker, and a collection's own `admin.defaultColumns` may still name it.
