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

The builder's controls now hold the words they draw in their accessible names, so a speech-input user who says what they see reaches them.

- A Design group's fold button ("Brand 1") and a Layers header or footer row draw a real space between their two words, which an accessibility check had read as one word.
- The Body and Headings font rows, the Site text rows and the block style rows are named by text inside the row, not by a label laid over the specimen they draw. A screen reader hears them as before.
- A header or footer drawn on the canvas is named the same way. Its drawn content is a picture of the region, so it is hidden from a screen reader, which hears the region's name as before.
- The canvas zoom reads "Canvas zoom: Fit, 60%" while fitting, the words it shows, instead of "fitting".
- The design token export in Design's ⋯ menu says its format, "DTCG 2025.10", as part of its name, since the format is drawn beside it.
