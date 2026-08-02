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

An error response can also carry a `_devDiagnostics` field with that detail, so an author sees why a request failed without reading the server log. It requires TWO signals: `NODE_ENV=development` AND `NEXTLY_DEV_DIAGNOSTICS=1`. Set the second in your local env file to switch it on. Neither alone is enough, because Nextly ships pre-built and stays external to your app build, so `NODE_ENV` is read at runtime and a production deployment started with the wrong value must not be able to disclose it. Production responses are unchanged either way.
