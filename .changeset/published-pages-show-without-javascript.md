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

A published page's content is now in the HTML it's sent, so it shows with JavaScript off, for a visitor or a crawler. With Cache Components on, the public page routes (`createPublicBlocksPage`, `createPublicSinglePage`, `createPublicContentPage`) render their page without a Suspense boundary, and a published render draws each asynchronous block in place. React had been sending a boundary's finished content in a hidden part that only its script shows, for any boundary holding an image or following more than a few kilobytes, so the whole page body was hidden until JavaScript ran. A miss answered by your own `notFound` (such as the SEO plugin's `notFoundLogged`) is still answered beneath a boundary, per request. A page with no `notFound` of its own now answers a missing path with a real 404. Pass `blockFallback` to stream asynchronous blocks instead. The access-enforced routes (`createBlocksPage`, `createSinglePage`, `createContentPage`) still render beneath a boundary under Cache Components, so their pages still need JavaScript there.
