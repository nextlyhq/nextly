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

Plugins can say what they need in the `nextly` key of their package.json: the Nextly versions and databases they work with, how they are placed in the config, companion packages, the plugins they require or work with, env vars, tables, collections and Singles, the content types they extend, the project files they add, commands and agent tools, install and uninstall steps, whether they can be switched off live, what they may access, and the steps before removing them. Nextly reads it as data, without running the plugin, and `nextly plugins add` refuses a declaration in a newer format than it reads with `PLUGIN_DECLARATION_FORMAT_NEWER`, naming the format and the Nextly versions the plugin works with. A package with only today's `nextly.plugin` block is added as before.

Plugin authors get the declaration's type, its JSON Schema and `checkPluginPackageDeclaration` from `@nextlyhq/plugin-sdk` (experimental). The check compares the declaration with the plugin's own definition and names each difference, so a plugin's tests fail when the two disagree; the declaration never widens what a plugin may do. A plugin made with `create-nextly-app`'s Plugin start now comes with a declaration and a `declaration.test.ts` that checks it.
