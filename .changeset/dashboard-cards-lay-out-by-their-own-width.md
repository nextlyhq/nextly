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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

A dashboard card lays itself out by its own width, small, medium or large, never by the
window's. A card below 340 px is small and from 700 px large, and the dashboard predicts each
card's tier from its own width and the card's span before the first query, so each card asks
only for what its tier draws.

- A list or table card draws three rows, titles only, when small; its number of items with a
  line of detail when medium; and a table with a heading per column when large. When its answer
  holds more rows than it draws, it says "More exist", and for a list from one collection that
  is a link to the collection's list view with the card's filter and sort.
- A breakdown draws its 3, 5 or 8 largest groups and says how many more there are, or that more
  exist when the answer itself was cut short.
- An over-time card shows the latest value and the total over its range when small, dates its
  line's two ends when medium, and adds dates between them when large.
- The Create card offers 2, 3 or 6 shortcuts and the rest in a More menu; the Team card shows
  the number of people alone when small; the Collections and Singles tiles take as many columns
  as the card fits.
- A card whose width grows into a tier that draws more asks again on its own; a card that
  shrinks asks nothing. Nothing in a card is clipped and nothing scrolls inside it.
- The entry list honours a `sort` in its address for a column its sort menu can order by.
