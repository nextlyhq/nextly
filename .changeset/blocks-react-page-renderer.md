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

Block documents now render. `PageRenderer` turns a stored document into a React tree on the
server: it upgrades every node to its block's current schema version, resolves the page
stylesheet and the class each node was assigned, and renders the tree with each block contained on
its own.

A block that throws, that rejects, that is no longer registered, that cannot be upgraded, or that
returns something React cannot render costs its own box and nothing else. Containment happens
where the block is called rather than in a client error boundary, because a Server Component's
error never reaches one, so a page of server blocks still ships no JavaScript for the renderer.
Only blocks that are genuinely asynchronous suspend, so a page of ordinary sections streams as one
piece instead of one chunk per block.

Documents render with or without the CMS: block definitions, the page context and the stylesheet
all arrive through seams that default to the CMS wiring and accept fixtures instead.
