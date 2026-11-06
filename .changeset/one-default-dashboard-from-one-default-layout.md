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

Every person with no saved dashboard now gets one default, built from one `defaultLayout`: the site's `admin.dashboard.defaultLayout`, or core's own when the site gives none. A site's default is applied: its cards, in its order, at the sizes it states and with its starting settings. An entry marked `optional: true` is left out without a fault when its widget is not installed.

After the default's own cards come the plugins' suggestions (`contributes.dashboard.suggest`), in the order the site lists its plugins, unless the site sets `suggestions: false`. Widgets of the older contribution shape are suggested by being declared, ordered by `defaultOrder`, so today's defaults keep their cards. A suggestion never reaches a dashboard someone has saved; the add panel offers it there.

Each person's default leaves out the cards they may not see, including a declared card whose `access` refuses them or whose `shows` answers no. A first save keeps those cards in the row, so they come back once shown.

Also in this release:

- `contributes.dashboard.widgets` is optional, for a plugin that adds only Needs attention items.
- `defineAttentionItem`, `AttentionItem` and `AttentionCount` are exported from `@nextlyhq/plugin-sdk` (experimental), for declaring a plugin's items under `contributes.dashboard.attention`; each reaches the attention digest as a warning.
- A list with an empty slot (`[a, , b]`) in `admin.dashboard` or `contributes.dashboard` is refused, naming the list.
- Startup's dashboard warnings go through the app's configured logger.
