---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

Adding a Collection list now asks, on the canvas, which collection it shows ("Show entries from") and a starting layout ("Cards, 3 across", "List rows", "Titles only", or Skip). The list then fills with real entries at once, as one undo step. The item is built from ordinary blocks already bound to each entry: the title, the first picture field, a summary field, and a link to the entry's page when entries have pages. A new list shows 6 entries, newest first, and its When-empty slot starts with "Nothing here yet.". While its collection has no entries, the canvas draws three greyed "Sample" items to design with, which never reach the live page. The loop collections read now says each collection's title field, which upload fields take images, and whether its entries have pages.

Output change: a new Collection list no longer starts on the `posts` collection with a limit of 3.
