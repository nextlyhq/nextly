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

Two public types now match what Nextly accepts and returns. Code that calls them compiles as before. A hand-written stand-in for the `Nextly` interface, such as a test double, must now return `token` and `exp` from `login`, as the real one always has.

- A job defined with a typed input, `defineJob<{ cursor: string }>(...)`, now goes into the config's `jobs` list, or a plugin's `contributes.jobs`, without a cast. Both lists now take any job, whatever input its handler takes. A value that is not a job is still refused, and a handler is still typed for its own input only, so it can't be called with another job's input.
- `login()` on the `Nextly` instance from `getNextly()` is now typed as `LoginResult`, the user with the session `token` and its expiry `exp`, which is what it already returned. The documented `result.token` now type-checks.
