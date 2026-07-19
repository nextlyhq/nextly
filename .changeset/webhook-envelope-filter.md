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

Add the webhook event envelope and filter-matching primitives.

Pure, storage-agnostic building blocks for the webhook system: the versioned `WebhookEvent` envelope (with computed `changedFields` and mandatory sensitive-field stripping), the endpoint and filter-spec types, `buildEnvelope()` for assembling an envelope from a resource's current and prior state, and `matchesFilter()` for evaluating a per-webhook filter at fan-out time. No delivery behavior yet; these feed the outbox-capture and delivery slices.
