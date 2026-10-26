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

Nextly does not support Next.js Cache Components yet, so it keeps it off. `create-next-app` 16.4 turns Cache Components on by default (`cacheComponents: true` with `partialPrefetching: true`).

- A project `create-nextly-app` creates sets `cacheComponents: false` in its `next.config`, with a comment saying why.
- When `create-nextly-app` adds Nextly to an existing app, it turns Cache Components off in that app's config and removes `partialPrefetching`, which Next.js accepts only with Cache Components on. Its report says what it changed and why. A setting it cannot read safely is left as it was, with what to change by hand.
- `withNextly()` and Nextly's start print a warning when Cache Components is on, with how to turn it off. They don't refuse: an app with it on is untested with Nextly, not known to be broken. The start check reads the setting from the app's `instrumentation.ts`, which now passes `cacheComponents: process.env.__NEXT_CACHE_COMPONENTS` to `createRegister`; `createRegister` takes it as an optional second argument.

Why, and the plan to support Cache Components before Next.js 17: https://nextlyhq.com/docs/getting-started/installation#cache-components
