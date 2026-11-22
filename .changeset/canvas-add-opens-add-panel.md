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

In the page builder, every add control on the canvas (the empty page's "Add section", an empty container's "Drop a block here, or click to add one", and the "+" between sections) now visibly answers, whether the Add panel was closed or already open: the panel opens if needed, its search takes focus, its list goes back to the top, and the line saying where the block goes is highlighted for a moment. Before, a press with Add already open changed nothing. In the Add panel, a tile's preview card now sits outside the panel, level with the tile, instead of over the tiles beside it, and it never blocks a click on the next tile. `InsertPanel` takes optional `summoned` and `onSummoned` props for a host to pass such presses.
