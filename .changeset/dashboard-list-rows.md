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

Every dashboard list draws with one row layout and one list card:

- Each row has a leading icon or avatar, a one-line title (cut with "…", the full text on hover and focus), a meta line of up to three fields, a trailing status or time, and a "…" menu named for its row. The whole row links to what it names; a row with nowhere to go is plain text.
- A list shows only the whole rows its card holds (3, 5 or 10 by size, at most 10) and never scrolls. When it holds more, one footer says so: "View all (N)" to the full list, or "N more" where there is no list to open. "More exist" is gone.
- Large cards draw the same rows as a table, with the same links and order.
- List cards gain a Density setting: default or compact rows.
- A collection list's answer now carries its total, from the same read, so "View all (N)" names the number the list it opens holds.
- Recent activity rows now open the entry or Single they are about, and Upcoming releases rows open their release.
- Removed: the unused `RecentEntriesWidget` export. A card's "Number of items" now goes up to 10, the most a list draws.
