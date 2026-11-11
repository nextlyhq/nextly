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

The server no longer waits for Nextly to start before it answers requests.

`createRegister(config)` in `instrumentation.ts` now begins Nextly's start and returns at once. Before, Next.js served nothing, not even the admin page or a static file, until the whole start had finished, which took over a minute against a database far from the server. Pages that need no database are now served straight away while Nextly starts.

Anything that needs the database waits for that one start instead of beginning another. That covers Nextly's own routes, the health route, `getNextly`, `getCachedNextly`, the `nextly` object and the content routes. Whichever starts Nextly first (the start-up hook, a request or the Direct API), the others now join the same start, so the permission and role seeding and the email templates no longer run twice when a request arrives while the hook's start is still running. A start that fails is logged, and the next request that needs the database starts Nextly again.

What to check in an existing app: code that calls `requireNextly()` (from `nextly/runtime`) synchronously in a request can now run while Nextly is still starting, and it throws until the start has finished, as it always has when nothing had started. `await getNextly({ config })` or `await getCachedNextly()` first, or use the `nextly` object, which waits. `shutdownNextly()` now waits for a start still under way before it shuts Nextly down.
