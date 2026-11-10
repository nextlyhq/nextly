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

Plugins can add filters to the entry list's toolbar (experimental).

- A plugin declares them in `contributes.admin.filters`. Each filter has options, and each option has a value, a label and a `where`.
- Choosing an option adds its `where` to the list's request, which the server answers with the reader's access, so a filter only narrows the list. The choice is kept in the page's URL (`?pf=<filter>:<value>`), and one naming an undeclared filter or option is ignored.
- The app refuses to start, naming the plugin and the filter, when a filter's name is outside the plugin's namespace, a filter is declared twice, or a filter has a malformed option.
- Filters reach only signed-in admins, through the workspace meta.
