---
"@nextlyhq/adapter-drizzle": patch
"@nextlyhq/adapter-mysql": patch
"@nextlyhq/adapter-postgres": patch
"@nextlyhq/adapter-sqlite": patch
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

Add the webhook and event system tables (nextly_events, nextly_webhooks, nextly_webhook_deliveries).

These three per-dialect core tables back the durable-outbox webhook system: an append-only event ledger (also the substrate for audit logging and workflows), the outbound-webhook endpoint registry (hashed secrets, subscribed events, structured filter), and the per-endpoint delivery ledger with retry state and an attempt log. They are registered as first-class managed tables, so the schema pipeline creates them on boot. No delivery behavior yet; this is the data model only.
