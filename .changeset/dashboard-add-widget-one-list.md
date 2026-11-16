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

Add widget is one list you can search. The drawer opens with focus in its search, then lists every widget you may add once, each with its icon, name, the plugin it comes from, one line about it, and Add. A one-card widget already on your dashboard says "On dashboard", and a widget that reads a collection says "Needs a collection you can read" when you may read none. The Suggested row, the Removed group, the filter chips and the step that asked for a collection are gone: Add puts the card at the end with its defaults and keeps the drawer open, a card that reads a collection starts on the first one no card of that widget uses yet, and Add on a one-card widget you removed puts that card back as it was. When every collection already has its card, the new card's settings open, and it is kept only once something tells it apart from the card it matches. The layout write refuses a card that reads a collection from a reader who may read none. The widget previews page is no longer served by the admin, on a development server or in production; its accessibility check of every widget's preview cases runs from a page of the end-to-end test app, and `@nextlyhq/admin/testing` exports the board it draws (`WidgetPreviewBoard`, experimental). Each core widget names an icon for the list.
