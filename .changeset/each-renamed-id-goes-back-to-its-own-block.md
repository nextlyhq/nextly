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

Saving part of a page as a pattern now puts each renamed id back on the right
block, even when blocks in the selection came from different patterns.

Before, a save had one answer per id for the whole selection. When two blocks
or two links disagreed about what an id used to be called, nothing was put back
and the pattern kept a page-specific id such as `pricing-4985ccb3`. Now each
block that carries an id is decided on its own, and a link follows the element
it points at: if that element is saved too, the link takes whatever id the
element ends up with, and otherwise the link goes back to the name its own
pattern gave it.

Existing pages and patterns need no change. Saves that already put ids back
store the same result as before; the difference is only in selections that mix
blocks from different patterns or components, which now keep correct ids where
they used to keep page-specific ones. `reidForestWithMap` accepts a new
`restoreEach` policy for callers that need this per-node decision.
