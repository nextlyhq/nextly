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

Pages built with nextly's route helpers now prerender a static shell under Next.js Cache Components. The blocks page helpers in `@nextlyhq/blocks-react/next` (`createBlocksPage`, `createPublicBlocksPage`, `createSinglePage` and `createPublicSinglePage`) render their page inside a `<Suspense>` boundary, so what a page reads at request time (a preview cookie, an access-enforced read, a path the build did not list) streams in beneath it. Their page components keep the same type. `createContentRoute` and `createSingleRoute` from `nextly/runtime` stay free of React: with Cache Components on, render their page inside a `<Suspense>` of your own, as the routing guide now shows.

An uncached read now waits for the request with Next.js's `connection()` instead of calling `unstable_noStore()`. Outside a request, in a script or a test, it runs as before.

`releaseBoundedRevalidate` from `nextly/runtime` takes the same arguments. With Cache Components off, nothing changes. With Cache Components on, it returns the lifetime you pass and reads neither the clock nor the database, so a scheduled release reaches a page cached there only through the cache tags its schedule flushes, not by shortening the page's lifetime. Cache Components stays off by default until a release going live refreshes cached pages under it too. Nextly reads whether Cache Components is on from the value Next.js writes into the code it bundles, so an app that loads `nextly` unbundled, as `serverExternalPackages` does, keeps the release bound.
