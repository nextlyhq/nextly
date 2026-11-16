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

The older widget shape is removed, with no alias, warning or migration. A widget is declared with `defineWidget` under a plugin's `contributes.dashboard.widgets` or the site's `admin.dashboard.widgets`, names its view with `WidgetView` (one of core's five views, or `{ component }`), and its component is handed `WidgetProps`. Startup still refuses a plugin carrying `contributes.admin.widgets` or `contributes.widgetSources`.

Removed exports:

- `nextly`: `WidgetDefinition`, `WIDGET_ARCHETYPES`, `WidgetArchetype`, `DataWidgetArchetype`, `QuerylessWidgetArchetype`, `CellWidgetArchetype`, `WidgetStatCell`, `WidgetAction`, `WidgetPatch`, `getWidget`, `listWidgets`, `CoreDisplay`, `ComponentDisplay`, `WidgetDisplay`, and the `PluginAdminWidget` family: `PluginAdminWidget`, `PluginAdminCustomWidget`, `PluginAdminDataWidget`, `PluginAdminStatsWidget`, `PluginAdminDeclarativeWidget`, `PluginAdminQuerylessWidget`, `DeclarativeWidgetArchetype`.
- `nextly/config`: the `PluginAdminWidget` family and `DeclarativeWidgetArchetype`, `WidgetArchetype`, `DataWidgetArchetype`, `QuerylessWidgetArchetype` and `CellWidgetArchetype`.
- `@nextlyhq/plugin-sdk`: `WidgetDefinition`, `WIDGET_ARCHETYPES`, `WidgetArchetype`, `DataWidgetArchetype`, `QuerylessWidgetArchetype`, `WidgetAction`, and the `PluginAdminWidget` family and `DeclarativeWidgetArchetype`.
- `@nextlyhq/plugin-sdk/widgets`: `WidgetComponentProps`, `WidgetSlot` and `WidgetQueryBatchResponse`.

A plugin's admin metadata no longer carries `widgets`, and the add panel lists a plugin's declared widget under that plugin.
