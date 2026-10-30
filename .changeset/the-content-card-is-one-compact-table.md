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

The dashboard's Content card is one compact table, `core/content-table`: a row per collection and Single the reader may see, with Entries, Drafts, when it was last updated, and a create button on each row. It takes `core/content`'s place in core's default dashboard.

- **Columns:** a collection's label links to its list; Entries and Drafts are counted as the reader; Updated is the row's own last update (a collection's newest entry the reader may read, or a Single's document), with who saved it on hover where the activity trail names them; and **+** opens a new entry, drawn only where the reader may create. A Single's row says "Single" in place of the counts and offers Edit.
- **Drafts** are counted by the collection list's own Draft filter and link to that filtered list, so the number and the list agree. A collection without Draft/Published shows "—". The `/stats` draft figure counts by the same rule.
- **Order:** the most recently updated first, with collections that hold no entries last and drawn muted. The card draws as many rows as its size holds. It has no "View all" link: the admin has no page listing every collection (`/admin/collections` redirects to one collection's entries), and each row opens its own list or Single.
- **Bounded:** the card is asked for the rows it draws, and only those are counted, rather than every collection on the site. To rank them, a load reads the latest update of at most 50 collections and Singles, four at a time: every one the activity trail's latest 50 saves name, then the rest by name. On a site with more than 50, the rest are not ranked and do not appear on the card.
- **Removed: the `core/content` widget.** The old Content tile card is gone, with no alias or conversion. A layout write naming `core/content` is refused, and a site `defaultLayout` or `hide` naming it no longer finds a widget. A reader whose saved layout already holds it keeps that card's place stored but no longer sees it, and adds Content again from the add panel. Use `core/content-table` instead.
- **Removed public export: `CollectionQuickLinks` from `@nextlyhq/admin`.** It was the tile card's body and has no replacement export. `ContentSingleTile`, its Single tile, is deleted too.
- **`system:content` rows** no longer carry `published`; they carry `canCreate`, `updatedAt` and who saved it, and the answer carries `total`, the number of collections and Singles the reader could be shown.
