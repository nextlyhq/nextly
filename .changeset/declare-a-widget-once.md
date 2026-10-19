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

A widget can be declared once with `defineWidget()` and contributed by a
plugin under `contributes.dashboard`. Both are exported from `nextly` as
experimental, with the setting builders as `widgetSettings` and the types
a widget's component is written against.

Startup checks every declared widget as it receives it, a plain
JavaScript plugin's included, and stops on any fault, all of them listed
in one message naming the plugin, the widget and what to change. Once the
site's content is synced, it also checks each widget's starting query:
startup stops over a field missing from a collection the code defines,
and warns, without stopping, over content the database alone holds.

Declared widgets are not yet offered on the dashboard: they are checked
and kept on the server, and appear once core can draw them. Widgets
contributed in today's shape keep working as before; two plugins sharing
an id now log a warning, and an id shared with a declared widget stops
startup.
