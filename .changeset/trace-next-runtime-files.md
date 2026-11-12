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

A Next.js site deployed on Vercel no longer answers 500 on every unknown address. Nextly loads Next.js's `next/navigation`, `next/cache`, `next/headers` and `next/server` at request time through a require the build's trace does not follow, so a deployment that ships only traced files could be missing a Next.js file they load, and `notFound()` failed with "Cannot find module". `withNextly()` now adds those files to every route's `outputFileTracingIncludes`, and `nextlyTracingIncludes()` from `nextly/next` gives the same list to a config not wrapped in it; new projects from `create-nextly-app` include it. Where a file is still missing, a not-found page answers 404 and a permanent redirect answers 308 with Next.js's own errors, cached reads run uncached, and the media revalidation after an upload is skipped, each named once in the log, instead of a 500.
