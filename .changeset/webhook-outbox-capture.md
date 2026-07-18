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

Add the webhook transactional-outbox capture core.

`recordEvent` is the single choke-point that persists an event and fans out one pending delivery per matching enabled endpoint through the caller's transaction, so the delivery obligation commits atomically with the content change. Adds `selectDeliveryTargets` (pure fan-out selection), `WebhookEndpointRegistry` (cached, invalidatable enabled-endpoint lookup), and `sensitiveFieldNames` (the password/hidden strip policy, walking nested groups/repeaters). No write-path wiring or network delivery yet; those land in the capture-wiring and delivery slices.
