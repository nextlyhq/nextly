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

Core's default dashboard is now the agreed set, in grid order: Set up your project across the row (12 by 2); Needs attention (8 columns) beside Upcoming releases (4); Continue where you left off beside Content (6 each); then the form-builder plugin's New form submissions card, named as optional so a site without the plugin leaves it out with no startup fault, beside Team activity. Each entry states its size, every row sharing one height. The Create card is no longer on the default; it stays in the add panel.

Continue where you left off and Team activity are offered only to a reader who may read a collection or a Single the dashboard lists, so a reader of no content is no longer shown two cards that could only be empty.

While only one of Needs attention and Upcoming releases is on show on the default dashboard, the admin draws it across the whole row. The width is drawn, never saved, and a dashboard the reader arranged keeps its own sizes.

No widget a plugin declares with `defineWidget` is placed on a default dashboard on its own any more. `contributes.dashboard.suggest` is still accepted and checked at startup, places nothing, and is deprecated: the add panel offers the plugin's widgets, and a site that wants one on its default names it in `admin.dashboard.defaultLayout` (`{ widget: "<id>", optional: true }` where the plugin may be absent). Nothing else follows the default's own cards any more, so the site config's `admin.dashboard.suggestions` changes nothing: it is still accepted and checked (`true` or `false`), so a config that sets it keeps starting, and is deprecated; remove it.

A reader who has saved their dashboard keeps it as saved; a reset returns to the new default.
