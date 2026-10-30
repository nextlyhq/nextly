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

- **Columns:** Name links to the collection's list or the Single; Entries and Drafts are counted as the reader; Updated is the row's last change, with who made it and what they did on hover; and **+** opens a new entry, drawn only where the reader may create. A Single's row says "Single" in place of the counts and offers Edit where the reader may update it, or View where they may only read it; both open the Single, read-only for a reader who may not update. The card's subtitle says how many collections and Singles the reader may see ("8 collections · 5 Singles").
- **Updated** and its name come from one change. Where the activity trail holds the row's latest change, a publish or an unpublish on its own included, the card shows that change's instant and who made it ("Published by Ben"). Where the trail holds none, it shows the row's own last update (a collection's newest entry the reader may read, or a Single's document) and names nobody.
- **By size:** a medium or large card, the default half-width card among them, draws the table. A narrow medium card, under 450 px wide as on a phone, keeps the table but draws Updated short ("5m") and leaves the action column out, so names keep their room; New in the dashboard's header still creates, and each name still opens its list or Single. A small card, under 340 px, draws each row's name on its own line with the counts and Updated under it. Every row is the dashboard's list row height, so the rows a card's size holds fill it.
- **Drafts** are counted by the collection list's own Draft filter and link to that filtered list, so the number and the list agree. A collection without Draft/Published shows "—". The `/stats` draft figure counts by the same rule.
- **Order:** the most recently updated first, with collections that hold no entries last and drawn muted. The card draws as many rows as its size holds and cuts the rest, with no footer: the subtitle says how many there are, the admin has no page listing every collection to link to (`/admin/collections` redirects to one collection's entries), and each row opens its own list or Single.
- **Bounded:** the card is asked for the rows it draws, and only those are counted, rather than every collection on the site. To rank them, a load reads the latest update of at most 50 collections and Singles, four at a time, and builds the rows it draws four at a time: every one the activity trail's latest 50 saves name, then the rest by name. On a site with more than 50, the rest are not ranked and do not appear on the card.
- **Removed: the `core/content` widget.** The old Content tile card is gone, with no alias or conversion. A layout write naming `core/content` is refused, and a site `defaultLayout` or `hide` naming it no longer finds a widget. A reader whose saved layout already holds it keeps that card's place stored but no longer sees it, and adds Content again from the add panel. Use `core/content-table` instead.
- **Removed public export: `CollectionQuickLinks` from `@nextlyhq/admin`.** It was the tile card's body and has no replacement export. `ContentSingleTile`, its Single tile, is deleted too.
- **`system:content` rows** no longer carry `published`; they carry `canCreate` (a collection's), `canUpdate` (a Single's, decided as a real update is), `updatedAt`, who made that change and `event`, what they did. The answer carries `total`, the number of collections and Singles the reader could be shown, and `totalByKind`, how that divides (`{ collection, single }`).
- **New, experimental: `totalByKind` on a list widget result** (`nextly/widget-result`), how `total` divides among the kinds of row a source answers. Optional; a source whose rows are of one kind leaves it out.
