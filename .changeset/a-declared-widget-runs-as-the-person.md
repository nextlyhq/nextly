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

A widget declared with `defineWidget` and drawn by a core display (`metric`, `list`, `table` and the others) now has its cards answered on the server, as the person asking, and drawn in the admin, in the widget's own words when it has nothing to show. A widget drawn by its own component (`display: { component }`) is checked at startup but not offered yet: the admin does not yet hand a component the props its declaration types, and development says so once per widget.

- **A card is asked for by its id**, and core builds its data from the widget's declaration: its `data` function run with the card's settings, the person and the batch's one instant, or its query written from the settings. Only a card the reader was handed is answered; every other card gets the one "unavailable" answer. While the dashboard is being customised, a card is asked with the settings it is drawn with.
- **Reads are the person's.** A data function's `services.count` and `services.find` read as the person asking, through the same check a card's own query passes, and read nothing once the card has given up. Options a plain JavaScript caller passes beside them (`user`, `as`, `overrideAccess`) are never read.
- **`WidgetDataInput` gains `now`** (`@experimental`): the batch's one instant, so every card asking for the last 30 days asks for the same days. `ResolverOptions` gains the same `now` (`@experimental`).
- **`WidgetResult` gains `{ op: "data", data }`**, a declared widget's own data for its own component, and a slot may carry `empty: true`, the verdict of the widget's declared empty test. The admin then draws the declared empty message and action, whose link is only ever a path under the admin.
- **Definitions gain `serverData`, `allowedWidths`, `defaultWidth`, `allowsSeveral`, `sketch` and `empty`.** Core publishes these for a declared widget. `registerWidget` refuses `serverData`, and an empty state's action is withheld from a reader without its permission.
- **Default dashboards** never place a declared widget; it is offered in the add panel instead.
