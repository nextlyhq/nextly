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

A limit store that every instance can share, selected by `rateLimit.store: "memory" | "database"`, for limits built on the new limit store contract. Core's own sign-in and API limits keep counting as before for now. Memory stays the default, and `rateLimit.singleInstance: true` says a site runs one instance. Each store holds a bounded number of live entries (`rateLimit.maxEntries`). It warns as it fills, and never drops a live count to make room. An app can supply its own store through the `@experimental` `LimitStore` contract, and check it against `limitStoreContract` from `nextly/testing`. An app's store of the earlier `RateLimitStore` contract keeps serving core's own limits. The database store adds the `nextly_limit_store` table, which reaches existing databases through `nextly migrate`.
