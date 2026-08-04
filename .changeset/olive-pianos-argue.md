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

Keep a typed error's status and code across the service boundary.

A service raising `authRequired`, `rateLimited`, `serviceUnavailable` or any
other 401 reached a REST caller as a generic 500, because the boundary rebuilt
errors from their HTTP status and only four statuses had a branch. A 400 was
rebuilt as a validation failure whatever code it carried, so a caller was told
its data failed validation when it had not been validated.

Errors are now rebuilt from the canonical code the envelope already carried,
with the status mapping kept as the fallback for envelopes that carry no code.
