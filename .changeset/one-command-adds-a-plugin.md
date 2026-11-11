---
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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

One command adds a plugin to a site: `nextly plugins add <package>` (also `nextly add <package>`) installs the package, registers it in `nextly.config.ts`, adds its `nextly plugins install` step to the build after `nextly migrate`, runs `nextly generate:types` and applies its schema; on a database not migrated yet, the schema is left to the build. A package says how it is registered in its package.json under `nextly.plugin` (the export, whether it is called, and the options its install asks for); one that declares nothing is registered by the plugin definition its entry exports. Options are given as `--option <name>=<value>` or asked for in a terminal, and a run without one in a script is refused, naming the flag. Nextly packages named without a version install at the version of `nextly` the site has. `--dry-run` names every change and makes none, and a second run changes nothing. Six new error codes cover what it refuses: `PLUGIN_PACKAGE_NOT_INSTALLED`, `PLUGIN_DECLARATION_INVALID`, `PLUGIN_REGISTRATION_UNKNOWN`, `PLUGIN_OPTION_MISSING`, `PLUGIN_OPTION_INVALID` and `PLUGIN_CONFIG_NOT_EDITABLE`.
