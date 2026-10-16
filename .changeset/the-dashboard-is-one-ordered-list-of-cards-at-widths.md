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

The dashboard is one ordered list of cards, each at a width

Cards now sit in one ordered list on the dashboard, filling rows left to right and wrapping, and each card is a quarter, a third, a half, two thirds or the whole row. The page-wide column count is gone. In customise mode each card has one menu to move it to the start, earlier, later or to the end, to change its width, to open its settings and to remove it; a removed card can be brought back with Undo. Reset asks first, and is saved only when you save.

Arrangements saved by an earlier release are converted when they are read: every card keeps its settings, a hidden card becomes a removed one, and the order runs across the tops of the old columns, then the next row down. Each card takes the width its saved size stood for, so a converted dashboard looks different from the columns view, with wider cards where a widget asked for them. The converted arrangement is stored in the new format the next time you save it, and going back to an older release after that save loses the widths.

If a saved arrangement cannot be read, the dashboard shows the default and says so, and saving over it asks first.

`COLUMN_COUNTS`, `DEFAULT_COLUMN_COUNT` and `ColumnCount` from `nextly/config` are deprecated: nothing reads them any more, and a later release removes them.
