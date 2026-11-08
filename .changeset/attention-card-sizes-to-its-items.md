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

On the dashboard, a card's saved height is now the most it is drawn at, and a row of cards is as tall as the tallest of the cards that share it needs. Needs your attention and Upcoming releases holding fewer items than their rows hold are drawn at the height their items take, so one item no longer sits above rows of empty room; the two cards side by side keep one height, with their bottoms aligned, at the taller of their contents. Cards side by side that span different numbers of rows are drawn at their saved sizes, as before. While either is loading it is drawn at the height of one item, so the cards below it do not move when a single item arrives. Every other card is drawn at its saved size as before, and holds its row at that height, and no card moves to another place. In customise mode every card is drawn at its saved size, so it can still be resized.
