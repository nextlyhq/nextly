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
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/builder": patch
"@nextlyhq/module-specifiers": patch
---

A Next.js site deployed on Vercel no longer answers 500 on every unknown address. On the server Nextly loaded the client `next/navigation` for `notFound()` and redirects, which Next's require hook sends on to the pages router's runtime, `react-dom`, `styled-jsx` and `client-only`, files a deployment that ships only traced files does not have. It now loads Next's server build of `next/navigation`, which needs none of them, by a literal specifier a tracer can follow. `withNextly()` also adds the Next.js files Nextly loads at request time (from `next/cache`, `next/headers`, `next/server` and that entry) to every route's `outputFileTracingIncludes`, and `nextlyTracingIncludes()` from `nextly/next` gives the same list to a config not wrapped in it; new projects from `create-nextly-app` include it. Where a file is still missing, a not-found page answers 404 and a permanent redirect answers 308 with Next.js's own errors, cached reads run uncached, and the media revalidation after an upload is skipped, each named once in the log, instead of a 500.
