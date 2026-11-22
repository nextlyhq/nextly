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

The Page Builder's header and footer no longer blink while you edit. Adding, moving, deleting or undoing a block, or resting the pointer near the footer, no longer hides the header's and footer's logo, links and buttons for a moment, and the footer no longer shrinks and grows while the pointer rests on its top edge. The entry page's small preview of the page also stops drawing again while you type in another field, and keeps its images when the page's content changes.

`PageRenderer` takes a new `keepAsyncOutputs` option for editor surfaces that draw a page without node addresses: what its async blocks drew is kept between draws, per page context. Published pages never set it and render as before. The renderer also compiles the site stylesheet once per change of what it is compiled from, rather than on every draw.
