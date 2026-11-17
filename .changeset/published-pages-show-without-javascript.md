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

A published page's content is now in the HTML it's sent, so it shows with JavaScript off, for a visitor or a crawler. React sends a finished Suspense boundary's content in a hidden part that only its script shows, once the boundary holds an image or follows more than a few kilobytes of the page. With Cache Components on, the public page routes wrapped the whole body in a boundary, and each asynchronous block had one of its own, so every published page was empty until JavaScript ran.

- `createPublicBlocksPage`, `createPublicSinglePage` and `createPublicContentPage` render their page without a boundary. A missing path answers a real 404, except a miss your own `notFound` answers (such as the SEO plugin's `notFoundLogged`), which is still answered beneath a boundary, per request.
- A page rendered on the server draws each asynchronous block in place and waits for it. `renderToString` and `renderToStaticMarkup` can't wait, so they now throw on a page holding an asynchronous block (a Button, an Image) where they drew nothing for it: render with `renderToReadableStream` and its `allReady`, or with `prerender`, or pass `blockFallback` to stream the blocks as before. A `PageRenderer` in a client component that is also rendered on the server needs a `blockFallback` too. In the browser and in the editor, blocks stream as before.
- Under Cache Components a public page is built whole, so a read still waiting when the build stops (an unregistered cached read, or a block that reads the request) now fails the build rather than leaving a part to fill at request time.
- The access-enforced routes (`createBlocksPage`, `createSinglePage`, `createContentPage`) still render beneath a boundary under Cache Components, so their pages still need JavaScript there; without Cache Components their response now waits for every block.
- In development, a public route with no `draft` hook reads the preview cookie, for its warning, only on a draft-mode request.
