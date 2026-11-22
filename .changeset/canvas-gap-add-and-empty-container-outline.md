---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
---

The page builder's canvas adds a block right where you point, without moving the page:

- A "+" floats over each gap between two top-level blocks, after the last block (above the footer), and between the children of the selected block, drawn down the line between blocks laid out in a row. It shows while the pointer is near the gap or on it, or while it has keyboard focus, and never while a block is dragged. Its name and tooltip say where it adds ("Add a block between Hero and Pricing", "Add a block after Contact"), it is a Tab stop in reading order, and Tab on the canvas with a block selected goes to the "+" below that block. Pressing it opens the in-place block picker aimed at exactly that gap, with nothing selected on the way. It never takes a press meant for a short block: near a block drawn shorter than the "+", it shows only right at the block's edge and lets go as the pointer moves towards the block's middle, and a touch screen keeps it shown only between blocks at least as deep as it.
- An empty Section, Box or other container is marked by a square dashed outline drawn just inside its edges, with no fill, so its own background, border and corners show exactly as styled, and "＋ Add a block, or drop one here" in its middle. Pointing at it, or focusing its "+", draws a solid outline in the selection colour with a light tint over it, as editor chrome rather than on the block. Pressing the "+" or the words opens the in-place picker aimed inside the container. The published page draws none of it.

`PageInserters` takes the selected block (`selectedId`), and its `onAddAfter` and `EmptyContainerAppenders`'s `onAppend` now also receive the control that was pressed, for the host to open the picker beside.
