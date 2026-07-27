---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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

nextly now ships content routing and sitemap/robots delivery from `nextly/runtime`: `resolveContent` (F1-cached published-by-slug lookup that rethrows on a transient error), `createContentRoute` (an optional catch-all factory that resolves any path to a published entry, with `generateStaticParams`, `generateMetadata`, and a reserved-path denylist), `isReservedPath`, and `nextlySitemap` / `nextlyRobots` for the canonical `app/sitemap.ts` and `app/robots.ts`. `cachedFind` now runs the read UNCACHED (instead of throwing a framework invariant) when called outside a Next request/build scope, so content reads work in tests, scripts, and other non-request contexts.
