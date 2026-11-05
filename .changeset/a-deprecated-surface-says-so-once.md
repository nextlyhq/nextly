---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/plugin-accounts": patch
"@nextlyhq/plugin-commerce": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/blocks-react": patch
"@nextlyhq/plugin-mcp": patch
"@nextlyhq/ui": patch
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/plugin-form-builder": patch
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

A deprecated surface now tells its user once per process, through one notice. `nextly/deprecation-notice` publishes `noticeDeprecation` (experimental): it names what is deprecated and what replaces it, and optionally the release it is removed in, and says each surface once however many copies of the module a bundle carries. The admin's notice for a sign-in challenge view that posts its own answer with `pendingToken` now goes through it, with the same words.

The published deprecation policy changes: a deprecated `@public` plugin surface now keeps working for at least two minor releases after the one that deprecates it, and is removed only at the next major release after those, rather than after one major version.
