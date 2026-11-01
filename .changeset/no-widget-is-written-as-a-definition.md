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

Every dashboard widget, core's own included, is now declared with `defineWidget`, so the older way of writing one as a definition is gone. Each card is answered on the server by its declaration's `load` and asked for by its card. The admin no longer asks a card's own query, a stats card's cells or a custom card's cells through the dashboard batch, and no longer draws the `text`, `actions` and `stats` archetypes, a self-drawn custom card that is handed no data, or a card footer link from the widget. A widget's view is a core view (`figure`, `list`, `table`, `bars`, `series`) or a component of its own (`view: { component }`).

Removed exports:

- `nextly/config`: `WidgetDefinition`. Declare the widget with `defineWidget` (from `nextly` or `@nextlyhq/plugin-sdk`) under a plugin's `contributes.dashboard.widgets` or the site's `admin.dashboard.widgets`. To migrate, move the definition's `title`, `description`, `size`, `settings` and `requiredPermission` onto the declaration (the permission becomes `access`), and replace its `query` with a `load` that returns the card's data.
- `nextly/config`: `WidgetAction`. There is no `actions` archetype: draw a card of shortcuts with a component of its own (`view: { component }`). To migrate, move the shortcut list into that component, and hide any shortcut the reader may not use there.
- `nextly/config`: `WidgetStatCell`. There is no `stats` archetype: declare one widget per number with `view: "figure"`, or draw several numbers with a component of its own. To migrate, move each cell's count into the card's `load`, and return the numbers as its data.
- `nextly/config`: `WidgetQueryCell`. A card no longer asks cells through the batch: its `load` reads everything it draws. To migrate, run each cell's query inside the card's `load` and return the answers together as its data.

A widget no longer carries `serverData`, `sizedQuery`, `dismissible`, `link`, `cells`, `actions`, `content` or a `query` of its own. Every card's "…" menu offers Remove, and a list's "View all" link is drawn by `Widget.List`'s `viewAllHref`.
