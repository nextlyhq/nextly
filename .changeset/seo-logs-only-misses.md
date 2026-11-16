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

The SEO plugin's log of addresses not found counts only requests a route answered not found. Logging from the site's `app/not-found.tsx`, as the guide showed, counted every page view, since Next.js renders that page for every page. `notFoundLogged()` from the new `@nextlyhq/plugin-seo/next` answers not found and logs the address once the response is sent, once per request though the page and its `generateMetadata` both answer it; pass it as a content route's `notFound`, call it from a site's own routes, and from an `app/[...missing]` catch-all for addresses no route matches. The Proxy no longer passes the address on for a prefetch, so a prefetch is never logged. `logNotFound` keeps working. Remove any logging from `app/not-found.tsx`.
