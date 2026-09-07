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

The build writes esbuild's module graph beside the bundles, so the format entry point's boundary can be checked against every edge rather than the ones initialisation happens to follow.

A graph observed by importing an entry point contains only what loading it resolved. A dynamic import behind a function is a real edge to a real dependency, and nothing asks the resolver for it until it is called — so the entry could reach a runtime dependency and every check still report a clean boundary. The metafile records every edge with its kind, deferred ones included, from the tool that emitted the code.

It is written to `dist` and excluded from the published package: it describes a build rather than shipping with one.
