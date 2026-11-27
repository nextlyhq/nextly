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

An empty Image in a row (a header's, a footer's, any Layout › Row) now draws a logo-sized placeholder on the canvas: no wider than 200px and as tall as the row's line, beside the blocks it sits with, instead of a 16:9 box as wide as the row that broke the row into lines. On a box that small, Upload, Media library and Link show as icon buttons named by their words, and a link being typed opens just below the box. Elsewhere the empty box is the 16:9 one it was, and published pages still draw nothing for an empty Image. A picture in a row keeps drawing at its own size, shrinking only where the row is narrower. `PageContext` gains an optional, experimental `rowItems`, which a container laid out as a row hands its children.
