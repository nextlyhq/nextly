---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/blocks-engine": patch
"@nextlyhq/eslint-config": patch
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
"create-nextly-app": patch
"nextly": patch
---

When a service raises a typed error, the public result shape drops its `cause` and `logContext` before the boundary rebuilds it, so an operator saw a generic reconstruction with none of the detail the thrower attached. The original is now kept for the request and logged against the same `requestId` the response carries, so the two can be joined.

In development only, an error response also carries a `_devDiagnostics` field with that detail, so an author sees why a request failed without reading the server log. The gate is `NODE_ENV`, which the bundler replaces at build time: a production build cannot be made to include it by any header, query parameter or role, and production responses are byte-for-byte unchanged.
