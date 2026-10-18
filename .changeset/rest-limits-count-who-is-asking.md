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

The REST rate limit now applies to every request, the admin API included, and
counts each one by who is asking. A signed-in session spends a budget of its
own, five times the per-address budgets by default (`rateLimit.sessions`), so
the admin's parallel page loads no longer need an exemption. An API key that
resolves spends its own `apiKeys.rateLimit` budget, counted once per request,
and a plugin's signed-in people each spend a budget the size of a session's.
Requests carrying neither from an address the server cannot resolve share a
ceiling of ten times the per-address budgets (`rateLimit.unresolvedCeiling`),
which never refuses a session, a key or a sign-in. Invalid API keys and
unresolvable plugin people are bounded before the next lookup. An app that
relied on the old exemption can pass the deprecated `defaultSkipAdminApi` as
`rateLimit.skip`; a later release removes it.

The limit's defaults now have one source, 100 reads and 30 writes a minute
per address, which is what every app configured through `defineConfig` already
ran on. A limiter built with no values used a second copy of 600 and 120; it
now uses the same 100 and 30. That narrows only code that reaches the limiter
without a sanitized config: `createRateLimiter()` called without `readLimit`
or `writeLimit`, and `createDynamicHandlers()` created without a config. Pass
the limits explicitly to keep the old numbers.
