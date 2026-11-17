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

A Columns row added in the page builder now asks for its layout on the canvas, in place of its two empty columns: "2 equal", "3 equal", "4 equal", "Wide left", "Wide right" and "Wide middle", the same tiles as the row's Layout setting, with "Skip", which keeps two equal columns. It works from the Add panel, the block picker and a drag, by mouse or keyboard alone (the arrows move between tiles, Enter picks, Escape skips). A pick is part of the insert, so one Undo removes the whole row. The step lives in the editor only and is never stored: clicking elsewhere, Escape or a reload leaves the row as two equal columns. Hosts that compose their own canvas can draw it with `FirstAddChoosers` from `@nextlyhq/builder/shell` (experimental).
