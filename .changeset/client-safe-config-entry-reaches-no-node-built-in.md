---
"nextly": patch
"@nextlyhq/plugin-accounts": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
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
"@nextlyhq/plugin-commerce": patch
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

`nextly/config` no longer pulls `node:crypto` into a browser bundle. It
published three dashboard layout limits from a module that also builds a hash
with `node:crypto`; the limits now come from a module with no imports, and keep
their values.

Every entry listed as safe for a browser is now checked: a test walks each
one's runtime imports and fails, naming the entry and the path, if any reaches
a Node built-in, a database package or a module marked with `server-only`. The
database-operator re-exports, the table DSL and the stored-bytes helper reach
server-only code by design and are imported only from server code, so they are
listed as server entries; this changes no build output.
