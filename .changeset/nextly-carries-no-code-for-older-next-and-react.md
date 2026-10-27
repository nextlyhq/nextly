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

nextly carries no code for Next.js or React releases it does not support, and refuses to start on one.

- **The start check.** When nextly starts (`getNextly()`), it checks the installed `next`, `react` and `react-dom` against the supported ranges (`next` ^16.4.1, `react` and `react-dom` ^19.3.0), each on its own. It refuses to start outside them, with a `CONFIGURATION_ERROR` naming each installed version and its range. A package the app does not have, as where the CLI or a test runs, is not judged.
- **Next.js APIs are used directly.** The Next.js 14 and 15 fallbacks are gone: `unstable_after`, a synchronous `draftMode()` or `cookies()`, and the checks of whether an export exists. If an API nextly uses is missing at run time, nextly throws a `CONFIGURATION_ERROR` naming the Next.js range it needs. Running outside a Next.js app, where `next` is not installed or there is no request, still works as before.
- **`createPreviewRoute`'s `draftMode` and `readPreviewScope`'s `cookies`** must return promises, as Next.js's own do. A synchronous function no longer type-checks; pass `draftMode` and `cookies` from `next/headers`, or make a test's fake `async`.
- **create-nextly-app** no longer reads the app's Next.js version to choose how to write `serverExternalPackages`. It writes the top-level option, which every supported release reads.
