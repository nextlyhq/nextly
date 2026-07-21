---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin": patch
"@nextlyhq/admin-css": patch
"create-nextly-app": patch
"@nextlyhq/eslint-config": patch
"nextly": patch
"@nextlyhq/plugin-form-builder": patch
"@nextlyhq/plugin-page-builder": patch
"@nextlyhq/plugin-sdk": patch
"@nextlyhq/prettier-config": patch
"@nextlyhq/storage-s3": patch
"@nextlyhq/storage-uploadthing": patch
"@nextlyhq/storage-vercel-blob": patch
"@nextlyhq/telemetry": patch
"@nextlyhq/tsconfig": patch
"@nextlyhq/ui": patch
---

Webhook signing secrets can now be generated and stored encrypted.

Delivery signs each request with the endpoint's secret, but nothing could produce one: there was no generator, and the decrypt step the delivery engine depends on had no implementation outside a test stub. This adds that boundary — a `whsec_` secret in the format Standard Webhooks receivers expect, encrypted under `NEXTLY_SECRET` with the same scheme that already protects email provider credentials.

Storing a signing secret requires `NEXTLY_SECRET` to be set. Unlike provider configuration, which degrades to plaintext when no key is present, a webhook secret is the signing key itself: stored readable, anyone with database access could sign requests your receivers would trust. It fails instead, and says so.
