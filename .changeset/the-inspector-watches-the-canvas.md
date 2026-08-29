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

Report a heading's typographic baseline even when its block renders
asynchronously.

The style inspector reads which element a node is drawn as by looking at the
canvas. That read was driven by a dependency list, and the DOM moves for reasons
no prop captures: a block whose `render` returns a promise commits its Suspense
fallback first and its resolved root later, changing neither the canvas element,
nor the selection, nor the document. The read therefore ran only before the
marked element existed, and an async block resolving to a heading reported its
font size as unset for as long as it stayed selected.

The reader observes the canvas subtree now, including the node-id attribute
itself — a node's id moving between elements changes the answer without adding
or removing any.
