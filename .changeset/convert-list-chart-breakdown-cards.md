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

Saved dashboard cards from core's generated per-collection widgets now become the widgets offered per collection, as saved count and health cards already became Count:

- a list or table card becomes Recent entries, which shows each entry's title, status and when it was updated from medium size, and is a table when drawn large;
- a timeline card becomes Over time, over the last 30 days, when it counted entries by when they were created;
- a breakdown card becomes Breakdown, by status, while its collection still has a draft and published lifecycle.

Each converted card is set to its collection, exactly the card a reader adds from the add panel; a Breakdown card also keeps grouping by status. It keeps its place, and its width is drawn at the nearest one its new widget allows. A collection's list and table cards become one Recent entries card. A converted card joins a card of the same widget the dashboard already holds for that collection only when that card has no other settings, so a filtered list stays as it was. A card is converted only when it can be converted exactly. Otherwise it stays as stored, out of view, and is never rewritten: a card whose collection the reader may not read (until they may), a timeline that counted by another date, a breakdown whose collection has no lifecycle any more, a deleted collection's card, and a plugin's card under a generated-looking id while that plugin is disabled.
