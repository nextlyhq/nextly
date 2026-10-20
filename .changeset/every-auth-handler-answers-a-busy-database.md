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

Every auth handler now answers a busy database as `DATABASE_BUSY` (503) with `Retry-After: 5`, as every other route does.

- **Setup-status, the setup pre-check and the refresh rotation** answer an unexpected failure with a 503 of their own, `SERVICE_UNAVAILABLE`. A request there that waited out `pool.connectionTimeoutMs` came back as that, with no busy code and no retry hint. It is now `DATABASE_BUSY`; any other failure keeps its `SERVICE_UNAVAILABLE`.
- **The password-reset and invite-acceptance responses** send `Retry-After` for an error carrying a retry hint, from the same helper the other response builders use.
- **`NextlyError.busyOr(error, otherwise)`** is the rule they share: "database busy" for a busy error, and the boundary's own error otherwise. `NextlyError.fromUnexpected` is that rule with the internal error as its fallback.
