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

Without nextly's cache handlers, a cached public read in production is now given a revalidate of 30 seconds. The app's `"use cache"` read function, as `create-nextly-app` writes it, expires it at 60 seconds, so no entry older than a minute is served; before, a read past the minute could still be served once while it refreshed. The warning for this case says it applies to an app that keeps a cache handler of its own too, and links the installation guide.

The warning for Cache Components or Partial Prefetching being off now goes through nextly's logger, as `cache-components-off` (and `cache-components-unknown` when `createRegister()` isn't told the value), so an app's own logger receives it. It no longer repeats the cache handlers, which have a warning of their own.

`create-nextly-app` no longer writes `require.resolve(...)` handler lines into an ES module `next.config` that declares `require` after its config object, where loading the config would throw. It prints the lines instead, and says to move the declaration. When it keeps an app's own cache handler, its report says what that costs: cached public reads refresh at least once a minute.
