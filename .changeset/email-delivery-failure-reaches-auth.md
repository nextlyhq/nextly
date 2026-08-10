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
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-seo": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/eslint-config": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
---

Report a failed email delivery to the auth flow that depends on it, and stop returning password-reset and verification tokens in production responses.

A provider failure was converted into an unsuccessful result rather than an exception, and the auth convenience methods returned nothing, so a failed password-reset send was treated as a delivered one: the user received no email and no token. Those methods now return the send result, and the auth flows check it.

Password-reset and email-verification tokens are no longer included in the API response when delivery fails in production. Outside production they still are, so a local install works before any email provider is configured.
