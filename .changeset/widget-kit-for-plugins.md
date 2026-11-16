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

A plugin's dashboard widget can be drawn by its own component. A widget declared with `defineWidget` and `display: { component }` is now offered on the dashboard. The admin draws its frame and its loading, no-permission and error states, and hands the component the props its declaration types: `WidgetProps` (data, settings, size, refreshing, retry). If the component throws while drawing, that card alone shows its error, with Retry.

`@nextlyhq/plugin-sdk/admin` now exports the widget kit, the parts core's own cards are drawn from: `CardSkeleton`, `CardEmpty`, `CardUnavailable`, `CardError`, `CardFigure`, `cardNumber`, `cardChange`, `GroupsChart` and `OverTimeChart`. They read the card's size and the admin's theme, so a plugin card matches core's in light and dark. `defineWidget` and the `WidgetProps`, `WidgetRenderSize` and `WidgetData` types are exported from `@nextlyhq/plugin-sdk`, and the types from `./widgets` too. All of it is `@experimental`.

Import the kit only through `@nextlyhq/plugin-sdk/admin`. If a second copy of the admin is loaded, development warns about it.
