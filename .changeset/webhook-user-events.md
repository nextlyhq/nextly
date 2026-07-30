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

Emit `user.created` and `user.deleted` webhook events. Both were already advertised as subscribable in the admin UI but had no emit sites, so an operator could subscribe to events that never fired. They now record into the transactional outbox atomically with the account change, through a new Drizzle-transaction recorder (`recordEventInTx`) that lets services running on `BaseService.withTransaction` — like the auth service — participate in the outbox without the adapter's positional transaction context. The payload is PII-safe: identity (id, email, name) and roles only, never the password hash or any token.
