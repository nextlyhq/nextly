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

The page builder gives every site one default Layout (experimental). Pages gain a **Layout** field (empty uses the site default) and a **No header or footer** switch, which always wins. The default is recorded in a new `page-builder-settings` Single and is chosen only through `POST /layouts/:id/make-default` on the plugin, which requires the new `manage-page-builder-site` permission plus update and publish on Layouts, and accepts only a published Layout. The default Layout cannot be deleted or unpublished. A new site gets a published "Default (site)" Layout as its default; an authored Layout with that name is never taken over, and a job repairs the default if it goes missing. `effectiveLayoutFor` (experimental) answers which Layout a stored page gets by that rule.

Existing sites get the new page columns and the Single through a migration: run `nextly migrate:create` and then `nextly migrate` (or `nextly db:sync` in development).
