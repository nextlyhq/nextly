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

An unpublished or unknown blocks page answers 404 again when Cache Components is off, which is every app's default. The page factories in `@nextlyhq/blocks-react/next` wrapped their read in a Suspense boundary, so the page's shell streamed before `notFound()` ran and the request answered 200 with the not-found page. They now add the boundary only under Cache Components, where a static shell needs it, and read before the page returns otherwise.

`nextly/runtime` now exports `cacheComponentsEnabled(value)`, which says whether a value means Cache Components is on: the config's `true`, or the `"true"` Next.js inlines into an app's bundle as `process.env.__NEXT_CACHE_COMPONENTS`.
