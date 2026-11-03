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

The Page Builder's rail now has a Components panel.

It lists the site's components you may read, by name, with a search, and
says so plainly when there are none. Choosing one places it where the Add
panel would place a block, after the selected block or at the end of the
page, and the panel names that place first. A component can be placed by
click, by keyboard (the arrow keys move from the search into the list, and
Enter in the search places the first match) or by dragging it onto the
canvas. Authors who may update components also get an Edit button on each
row, which opens the component alone and returns to the page afterwards.

The panel reads the same component library as the Add panel and the
editor's search, and places through the Add panel's own path, so the two
panels never offer or place a component differently. Components in the Add
panel can now be dragged onto the canvas too, as blocks already could.
