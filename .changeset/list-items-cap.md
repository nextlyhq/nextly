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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Render a very long list instead of losing the block that holds it.

`core/list` mapped its stored `items` with no cap. A document's own limits bound node count and depth but never the length of a prop array, so `items` arrives at whatever length was written — and past the renderer's inspection budget the normalizer refuses the whole output. An accidentally long list therefore cost the reader EVERY item and left a broken-block marker where the list should be, rather than costing only the items past the end.

The items are clamped, and sliced before they are mapped so an oversized array is never walked in full: the work this bounds is the work of reading it, not only of rendering it. The cap sits far above any list a person writes and far below the budget, so nothing hand-authored reaches it and the block still has room for its wrapper.
