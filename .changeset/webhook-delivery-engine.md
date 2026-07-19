---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
"@nextlyhq/admin-css": patch
"@nextlyhq/admin": patch
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

Webhook deliveries are now sent, signed, and retried.

The delivery engine claims each due webhook delivery, signs the request with Standard Webhooks HMAC headers, sends it over the SSRF-safe transport, and records the outcome. A 2xx marks the delivery sent; a 429 or 5xx is retried with exponential backoff and full jitter up to an attempt cap; any other response fails permanently. A claimed delivery is leased so a concurrent drain cannot double-send, and the network request never holds a database transaction open. A drain orchestrator runs fan-out and delivery together until nothing is currently due. The scheduled trigger that starts a drain is a later change.
