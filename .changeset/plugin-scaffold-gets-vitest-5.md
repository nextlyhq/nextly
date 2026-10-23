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

A new plugin from `create-nextly-app` gets Vitest 5 (`vitest ^5.0.5`) instead of Vitest 4, with `vite` declared beside it (Yarn installs no peers, so `yarn test` could not load Vite without it).

Vitest 5 needs Node 22.12 or later, so the plugin's `package.json` now says so in `engines` (`^22.12.0 || ^24.0.0 || >=26.0.0`).

In a test written for Vitest 4, check for these:

- `expect(promise).resolves` or `.rejects` that isn't awaited now fails the test.
- Mock call history is cleared before every test (`clearMocks` is on by default).
- `vi.mock` and `vi.hoisted` inside a function or block now throw.

The full list is in Vitest's migration guide: https://vitest.dev/guide/migration
