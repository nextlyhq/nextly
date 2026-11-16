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

A plugin can now change one collection's document screen through `contributes.admin.views[slug]`, from `@nextlyhq/plugin-sdk`. `documentActions` hides the built-in Delete or Unpublish there, or keeps the action's row and opens the plugin's own component in its place; the permission it needs, a colleague holding the document and a past version on screen still hold it. `panelSections` adds sections to the document panel after Details, drawn under the panel's own heading. Both are experimental and apply to collections only. The app refuses to start on an action that cannot be overridden, an override or section with nothing to draw, or two plugins overriding one action on one collection.

A save the server refuses with a reason about a field now shows that reason on the field, and keeps the author's edits. Reasons no field on the form shows are said in the toast, rather than a bare "Validation failed.".

`recordAdvisoryNotice` is exported from `@nextlyhq/plugin-sdk` (experimental), so a plugin's hook can tell the person saving something true about what their write leaves behind; it is shown beside the save's success as core's own notices are.
