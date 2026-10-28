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

The blog template builds and serves with Next.js Cache Components and Partial Prefetching on, against an empty database and against seeded content. It still works as before with them off, which is how a new project is created.

- The route segment exports Cache Components refuses are gone: `runtime = "nodejs"` from the five Open Graph routes (Node.js is the default), `dynamicParams = true` from the post page (the default), and `dynamic = "force-static"` from the search page (it is static without it).
- The post and author pages, like the category and tag pages before them, prerender one placeholder path when the database has none. Cache Components refuses an empty `generateStaticParams`, and the placeholder answers not found.
- The footer's year is read inside a cached read, and the RSS feeds take their dates from the posts rather than the clock, so no render reads the clock outside a cache.
- An unknown category or tag is now decided before the page reads `?page=`. Under Cache Components, the first request for a slug that does not exist gets the not-found page with `noindex`, and every later request gets a 404.
- The error pages' "Try again" button calls `retry()`, which fetches the page again, rather than `reset()`, which only re-rendered what had already failed.
