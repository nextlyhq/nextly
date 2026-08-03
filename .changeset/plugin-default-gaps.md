---
"nextly": patch
"create-nextly-app": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
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
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

The page builder now states the core version it actually needs, an empty default is checked against the column it will occupy, and a user field's plugin options are refused when JSON cannot hold them unchanged.

`@nextlyhq/plugin-page-builder` requires `nextly` 0.0.2-alpha.49 or newer, the release that first exports `pluginField`. Installed against an older core it now fails at install rather than throwing when a `blocks()` field is evaluated.

A single's default that resolves to an empty value is validated against the field's storage primitive and its type's own rules, instead of being treated as a field the writer left alone; a number-backed default of `""` no longer reaches the insert. Options declared on a code-defined user field are refused when they are values JSON cannot represent — a `Date`, `Set`, `Map`, `BigInt`, function or cycle — which previously either reached the admin component reshaped or failed the whole startup sync.
