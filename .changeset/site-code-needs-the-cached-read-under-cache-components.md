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

`<SiteCode>` no longer fails a production build now and then under Cache Components. It read the site code through `unstable_cache` whenever the app's `"use cache"` read function was not yet registered, and on a route that imports nothing that registers it, `/_not-found` among them, that read could still be running when the prerender stopped. It now stops with an error that names the fix instead: add `src/nextly/cached-read.ts` and import it from the layout that renders `<SiteCode>` (`import "@/nextly/cached-read";`). With Cache Components off, or with a `read` of your own, nothing changes.

New apps need nothing: the base, blank and blog templates and the plugin template's dev app now ship `src/nextly/cached-read.ts` and import it from their root layout. That one import registers the cached read, and registers how Nextly starts (`registerNextlyStart(() => getNextly({ config }))`) for a read that finds it not started, so a page only the root layout renders, such as `/_not-found` during `next build`, starts Nextly rather than failing with "getCachedNextly() called before initialization". Nothing starts eagerly, so an app page that calls `getNextly` with options of its own first still starts it with them. An app made by an earlier release that renders `<SiteCode>` under Cache Components adds both, as the [site code page](https://nextlyhq.com/docs/page-builder/site-code#with-cache-components) shows.

`nextly` adds `registerNextlyStart(start)`, which `getCachedNextly()` runs only when nothing has started Nextly, nothing is starting it and no failed start is left to retry.

`nextly/runtime` adds `cachedReadRegistered()`, which says whether the app has registered its `"use cache"` read function in this process.

`getCachedNextly()` now starts Nextly again after a start that failed, with the complete options that start was given (its config and any adapter, logger, image processor or service overrides beside it), so a worker whose first start met a database that was down recovers once the database is back instead of refusing every read until it restarts.
