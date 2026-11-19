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

Chips in a written email read by their friendly names (`@experimental`): a variable shows its declared label and the labels along its path, so `order.total` reads "Order › Total". Inside a list, the list offers its items' own fields as chips, and inserts them only into the blocks it repeats.

A chip with no test value and no fallback is marked. Clicking a chip opens its fallback dialog, which sets the text shown when the variable is missing, null or empty; false and 0 still show.

Text in a text block can be linked: select it and choose Link, then give a complete address or pick a variable that holds one, by its friendly name. Only the selected text changes, so a link it cuts through keeps its address on the rest. A link can be edited or removed the same way.

An image block can be chosen from the media library. Its address is made complete, so a sent email loads it, and the library's alt text is used when the block has none.
