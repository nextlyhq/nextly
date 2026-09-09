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
"@nextlyhq/plugin-form-builder": patch
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

The synchronous Direct API accessor is now `requireNextly`, exported from `nextly/runtime`. It was `getNextly`, which is also what `nextly` exports for a different function: one initialises, takes a required config and returns a promise; the other reads the already-registered singleton, takes nothing and throws when the process has not booted. One name, two functions, opposite tolerance for an uninitialised runtime, and nothing at an import site to say which one arrived.

`getNextly({ config })` from `nextly` is unchanged. It is the one to reach for: it initialises rather than assuming, so it is correct whether or not something else has booted, and it caches, so calling it per request is a lookup after the first. `requireNextly()` is for code that provably runs after initialisation, and its name now says that it will throw otherwise.

Two pieces of documentation that the shared name had made wrong are corrected with it. The accessor's own example told readers to import it from `nextly`, where that name resolves to the other function, so the snippet could not compile. The convenience proxy's note said the runtime is initialised "via `getNextly()`", which is the other one again.

A test asserts that no name is published from two entry points with different arities. It found two more of the same shape, `isFieldGroupType` and `createAdapter`, which are recorded so a fourth fails on the day it appears.
