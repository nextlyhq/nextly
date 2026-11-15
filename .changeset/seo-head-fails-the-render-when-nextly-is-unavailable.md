---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

In production, a page's SEO head now fails the render when Nextly is unavailable (it could not be started, the database is busy, unreachable or timed out), instead of serving the route's own metadata. A revalidation keeps serving the page's last good render, a first request with nothing cached answers with an error, and `next build` fails rather than shipping pages without their SEO head. `next dev` still serves the route's own metadata, and any other failure (a bad answer, a plugin bug) still falls back everywhere. This covers the route helpers and the SEO plugin's `seoMetadata` and `seoStructuredData`. Plugins can apply the same rule with `failRenderWhenUnavailable` and `isNextlyUnavailable` from `@nextlyhq/plugin-sdk` (experimental).
