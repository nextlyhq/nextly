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

**Every dashboard card is drawn in one frame, which draws every state.** (experimental)

- **One header, one height.** A card's header is one fixed height in every state, size and mode. It shows the card's subject as its title ("Posts") and the widget's own name beneath it when the two differ ("Count"); a card set to no collection is titled as its widget. The quick control and the card's menu sit at the header's right end, in that order, on every card. The declaration's description is no longer drawn in the header (the add panel still shows it).
- **One spacing.** Cards are padded 16 px with 12 px between header and body. The grid puts 16 px between cards, widening to 24 px across (never down) where the dashboard is at least 1,280 px wide.
- **The frame draws every state.** Loading, refreshing, empty, error and not-available are drawn the same way on every card, from one `CardState`. A failed answer for a card drawn by its own component is now the frame's error, with Retry, or the one not-available state; the component is not called. A component that reads something more from a good answer (nothing in it, or an answer it cannot read) returns `FrameState` with that state, and the frame draws it.
- **No "Updated" line on cards.** Cards no longer say when their data arrived. The dashboard grid marks when the oldest answer it shows arrived (`data-answered-at`) for a page-level indicator.
- **Refresh in the card menu.** Every card that asks for data has Refresh in its menu, which asks again for that card alone. The menu stays reachable while the card's settings cannot be saved; only Settings is disabled then.
- **`hidesWhenEmpty`** on `defineWidget` (and core's own declarations) takes a card off the dashboard while its answer is empty, rather than drawing the empty state. A failed or not-available card is never hidden, and customise mode still shows it, marked "Hidden while empty".

**Breaking, with no replacement or deprecation period:**

- `chrome` is gone from widget declarations, and a widget that names it is refused at startup ("chrome is not a widget field"). Every card is framed. `WIDGET_CHROME` and `WidgetChrome` are no longer exported from `nextly` or `@nextlyhq/plugin-sdk`.
- `CardEmpty`, `CardError`, `CardSkeleton` and `CardUnavailable` are no longer exported from `@nextlyhq/admin` or `@nextlyhq/plugin-sdk/admin`. A widget's component returns `FrameState` instead.
- `RecentEntriesWidget` and the standalone `RecentActivity` section (and `RecentActivityProps`) are no longer exported from `@nextlyhq/admin`; the dashboard's own Recent entries and Recent activity cards replace them.
