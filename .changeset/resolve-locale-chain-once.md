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

A collection read, a single read and an embedded component read now resolve a
translatable field through one language chain rather than three private copies
of the same rule.

Nothing published changes for a reader: the three copies agreed, and the
per-request `fallbackLocale` contract — `false` or `"none"` for the requested
language alone, a named locale to fall back through that locale's own chain,
otherwise the configured chain under the global `fallback` switch — is exactly
what each path answered before. What changes is that a future difference in
how a single and a collection fall back is no longer possible by omission:
there is one place to change, and the drift the three copies invited is closed.
