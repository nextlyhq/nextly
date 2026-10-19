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

A plugin route declared with `rateLimit: "auth"` can no longer be closed to everyone by one visitor when no client address can be read (the default, without `security.trustProxy`). Before, every such client shared one bucket per route, so one visitor spending the auth budget refused the route to all. Now each request counts against the identity the route's new, optional `limitKey` names, at the auth budget, under a ceiling of 100 times that budget that only the plugin's own auth routes share. A route without a `limitKey` is bounded by that ceiling alone, and the server names it at startup. Core's sign-in and other plugins keep their own ceilings. Auth routes are no longer listed in the startup warning about routes sharing one limit.
