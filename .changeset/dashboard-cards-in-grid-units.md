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

**Breaking:** a dashboard card's size is now `{ w, h }` on a 12-column grid, with rows of one fixed height (`w` from 1 to 12, `h` from 2 up). That is the only way to state a size. `defineWidget` takes `size: { default, min?, max? }` in place of `widths` and `width`, and so do registered and contributed widgets, in place of `defaultSize`, `minSize`, `maxSize`, the allowed and default widths, `defaultHeight` and `size: "half" | "full"`. The site config's `admin.dashboard` takes `w` and `h` on `defaultLayout` cards, and `overrides[id].size` narrows a widget's bounds without ever widening them. A widget's own component is handed its size as `{ w, h, tier }`. `WIDGET_SIZES`, `WIDGET_WIDTHS`, `WIDGET_HEIGHTS` and their types are removed, as are the unused `DEFAULT_COLUMN_COUNT` and `COLUMN_COUNTS`; `GRID_COLUMNS`, `GridSize`, `WidgetSizeDeclaration`, `WidgetSizeBounds` and the size helpers are added.

**Breaking:** saved dashboards are reset. The stored layout moves to format version 4. A dashboard saved in an earlier version (1, 2 or 3) is read as not saved, so its owner sees the current default dashboard, and the old row is replaced the next time they save anything. Nothing from an earlier layout is carried over.

The dashboard reflows by its own width, not the window's. At 1,024 px and wider every card is drawn at its `w`. From 640 to 1,023 px a card of 6 columns or fewer is drawn at 6 and a wider one at 12. Below 640 px there is one column. A card keeps its height in every band, and a reader resizes a card's width and height from its menu, within its widget's bounds.

The admin sidebar no longer draws the previous section's panel for a frame after a navigation, which moved the whole page as it closed.
