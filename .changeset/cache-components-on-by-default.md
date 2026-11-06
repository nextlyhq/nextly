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
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/eslint-plugin": patch
"@nextlyhq/module-specifiers": patch
"nextly": patch
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
---

Cache Components and Partial Prefetching are now on in every Nextly app, and Nextly supports only that state.

- A project `create-nextly-app` creates sets `cacheComponents: true` and `partialPrefetching: true` in its `next.config`, with Nextly's cache handlers (`cacheHandler`, `cacheMaxMemorySize: 0` and `cacheHandlers.default`), which make the first read after a write show the new version. A `next.config.mjs` defines `require` with `createRequire` to resolve them.
- A new blog's `src/nextly/cached-read.ts` is the `"use cache"` read function itself, so its reads go through it from the start. The separate `cached-read.cache-components.txt` is gone.
- When `create-nextly-app` adds Nextly to an existing app, it turns both options on where either is off or missing, including in an app an earlier Nextly release turned off, and adds Nextly's cache handlers. Its report names each change. A setting it can't read safely (a spread, a computed value, a wrapper call) leaves the file as it was, and the report prints the exact lines to add. A config with a cache handler of its own keeps it, and the report prints Nextly's handler lines.
- The blank template's home page reads the admin's setup status inside a `<Suspense>` boundary, so it prerenders as a static shell under Cache Components.
- Nextly warns once at start when Cache Components is off, from the value `instrumentation.ts` passes to `createRegister`, and `withNextly()` warns once when either option is off in the config it wraps. `partialPrefetching` reaches no code while an app runs, so only `withNextly()` can check it. The old warning that Cache Components is unsupported is gone.

`createRegister(config, { cacheComponents })` is unchanged: keep passing `process.env.__NEXT_CACHE_COMPONENTS` from `instrumentation.ts`.

**Upgrading an app made by an earlier release**, which has `cacheComponents: false`: run `create-nextly-app` in the app again, or set `cacheComponents: true`, `partialPrefetching: true` and Nextly's cache handlers in `next.config` by hand. A blog also replaces its stub `src/nextly/cached-read.ts` with the read function the caching guide prints. What to set, and why: https://nextlyhq.com/docs/getting-started/installation#cache-components
