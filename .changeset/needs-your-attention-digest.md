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

The dashboard's Needs attention card is now "Needs your attention": a digest of open work waiting for the reader, which leaves the dashboard while nothing is waiting.

- One row per item, most urgent first: releases that stopped and overdue releases (critical), then items plugins add (warnings). Each row shows its severity by shape as well as colour, the item's label and count ("Overdue releases · 2", "99+" past the cap), why it is waiting, and one Review.
- An item whose count could not be read says "Not all checked" with a Retry, so the card never reads as clear while something went unchecked. Nothing on the card dismisses an item; it leaves when the work is done.
- At its new default of 8 by 3 the card draws the items that fit and folds the rest behind "Show N more", which grows the card in place until "Show less". Create, beside it on the default dashboard, is 3 rows tall to match.
- The card no longer counts unpublished changes or entries publishing this week: those are the Content table's and Upcoming releases' to show.
- It is answered as the caller who asked, so an API key sees only the items its own grant reaches.
- A plugin's attention item (`defineAttentionItem`, experimental) may give an optional one-line `reason`, drawn under its label. Startup refuses a reason that is empty or spans lines.
- A list row's one action may carry a longer accessible name than its visible label.
