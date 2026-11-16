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

The Page Builder's left rail now names every panel under its icon, and offers only the panels that work: Add, Layers and Design at the top, Settings and Help at the bottom. A panel that is not built yet no longer shows as a disabled "coming soon" item.

Design gathers the site's variables, classes and fonts into one panel with three tabs, and the editor remembers the tab you left on. Help lists the keyboard shortcuts in effect, from the same registry the keyboard uses, and links to the new "Using the editor" documentation page.

For hosts of `@nextlyhq/builder` (experimental API):

- The panel ids changed: `insert` is now `add`, and `tokens`, `classes` and `fonts` are now the tabs of one `design` panel. A stored preference naming an old id opens the panel and tab it became.
- `renderPanel` receives a second argument, a `PanelView` (`current` and `choose`), for a panel with parts.
- `openPanelRequest` takes an optional `view`.
- `ShellPreferences` has a new required field, `leftPanelView` (`string | null`, the open panel's part). Code that builds a `ShellPreferences` value adds it, `null` for none; spreading `DEFAULT_PREFERENCES` covers it. Preferences stored before this change still load, with no part chosen.
- `RAIL_WIDTH` is 84.
