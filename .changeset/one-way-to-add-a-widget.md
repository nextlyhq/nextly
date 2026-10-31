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

A plugin adds dashboard widgets one way: each declared with `defineWidget` under `contributes.dashboard.widgets`, its data read by the widget's `load` as the person asking. **Breaking:**

- `contributes.admin.widgets` and `contributes.widgetSources` are no longer fields of a plugin's contributions. Startup refuses a plugin that still carries either, naming the plugin and the key, with the new error code `NEXTLY_PLUGIN_REMOVED_WIDGET_CHANNEL`. Declare each widget with `defineWidget` under `contributes.dashboard.widgets`, and read its data in its `load` (`services.count`, `find`, `groupBy`, `timeseries`) instead of answering a source.
- `nextly` no longer exports `registerWidget`, `overrideWidget`, `extendWidget`, `deregisterWidget` or `registerSource`. Declare a widget with `defineWidget` under `contributes.dashboard.widgets` (a plugin) or `admin.dashboard.widgets` (the site config), and change, replace or hide another widget with the site config's `admin.dashboard.overrides`, `replace` and `hide`.
- `@nextlyhq/plugin-sdk` no longer exports `registerWidget` or `registerSource`; declare the widget with `defineWidget` under `contributes.dashboard.widgets`.
- `nextly` and `@nextlyhq/plugin-sdk` no longer export the types `PluginWidgetSource`, `PluginSourceResolver` and `PluginManySourceResolver`, the contract `contributes.widgetSources` took. A widget's `load` is typed by `defineWidget`.
