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

A plugin can now switch the fields its `extend` added off on some types, without a schema change (experimental). It contributes a service named `EXTENSION_SWITCH_SERVICE` (from `@nextlyhq/plugin-sdk` and `nextly`) whose `switchedOff(field)` lists the types the field is off on now. On those types the admin draws the field nowhere on their pages, and offers none of the plugin's `extendedWith` contributions there. The column and every stored value stay, the API keeps reading and writing them, and switching the type on again brings everything back. The admin reads the switch each time it loads its workspace, so a change applies without a redeploy. A switch that fails switches nothing off and is logged.
